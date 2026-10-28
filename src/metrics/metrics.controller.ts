import { Controller, Get, Put, Query, Delete, Res, Param, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { MetricsService } from './metrics.service';
import {
  HistoryStorageService,
  METRICS,
  MetricKey,
  RETENTION_POLICIES,
  isMetricKey,
} from './history-storage.service';
import { SystemGateway } from '../system/system.gateway';
import { getTimestamp } from '../common/utils/metrics.util';
import { ApiResponse } from '../system/system.types';

// Upper bound on rows a single history request may ask for.
const MAX_HISTORY_LIMIT = 100_000;

function parseMetric(value: string | undefined, fallback?: MetricKey): MetricKey {
  if (value === undefined || value === '') {
    if (fallback) return fallback;
    throw new BadRequestException('metric is required');
  }
  if (!isMetricKey(value)) {
    throw new BadRequestException(`metric must be one of: ${METRICS.join(', ')}`);
  }
  return value;
}

function parseLimit(value: string | undefined, fallback: number | undefined): number | undefined {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_HISTORY_LIMIT);
}

function parseTime(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new BadRequestException(`${name} must be an ISO 8601 timestamp`);
  }
  // Normalised so string comparison against stored ISO timestamps is reliable.
  return new Date(ms).toISOString();
}

@ApiTags('Metrics')
@Controller('api/v1')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly historyStorage: HistoryStorageService,
    private readonly gateway: SystemGateway,
  ) {}

  @Get('metrics/history')
  @ApiOperation({ summary: 'Get metrics history with optional time range' })
  @ApiQuery({ name: 'metric', required: false, enum: METRICS })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'startTime', required: false, type: String })
  @ApiQuery({ name: 'endTime', required: false, type: String })
  getMetricsHistory(
    @Query('metric') metric?: string,
    @Query('limit') limit?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ): ApiResponse<any> {
    const data = this.metricsService.getHistory(
      parseMetric(metric, 'cpu'),
      parseLimit(limit, 1000),
      parseTime(startTime, 'startTime'),
      parseTime(endTime, 'endTime'),
    );
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('metrics/history/all')
  @ApiOperation({ summary: 'Get recent history data across all metrics' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max entries per metric (default 1000)' })
  @ApiQuery({ name: 'startTime', required: false, type: String })
  @ApiQuery({ name: 'endTime', required: false, type: String })
  getAllHistory(
    @Query('limit') limit?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ): ApiResponse<any> {
    const data = this.historyStorage.getAllHistory(
      parseLimit(limit, undefined),
      parseTime(startTime, 'startTime'),
      parseTime(endTime, 'endTime'),
    );
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('metrics/history/stats')
  @ApiOperation({ summary: 'Get history storage statistics' })
  getHistoryStats(): ApiResponse<any> {
    const data = this.historyStorage.getStats();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('metrics/history/export/:metric')
  @ApiOperation({ summary: 'Export history as CSV for a specific metric' })
  @ApiQuery({ name: 'startTime', required: false, type: String })
  @ApiQuery({ name: 'endTime', required: false, type: String })
  exportHistoryCsv(
    @Param('metric') metric: string,
    @Res() res: Response,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ): void {
    const key = parseMetric(metric);
    const csv = this.historyStorage.exportCsv(
      key,
      parseTime(startTime, 'startTime'),
      parseTime(endTime, 'endTime'),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="metrics-${key}-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Get('metrics/history/export')
  @ApiOperation({ summary: 'Export all history as CSV' })
  @ApiQuery({ name: 'startTime', required: false, type: String })
  @ApiQuery({ name: 'endTime', required: false, type: String })
  exportAllHistoryCsv(
    @Res() res: Response,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ): void {
    const csv = this.historyStorage.exportAllCsv(
      parseTime(startTime, 'startTime'),
      parseTime(endTime, 'endTime'),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="metrics-all-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Delete('metrics/history')
  @ApiOperation({ summary: 'Clear history data' })
  @ApiQuery({ name: 'metric', required: false, enum: METRICS })
  clearHistory(@Query('metric') metric?: string): ApiResponse<any> {
    const key = metric === undefined || metric === '' ? undefined : parseMetric(metric);
    this.historyStorage.clearHistory(key);
    return { success: true, data: { cleared: key || 'all' }, timestamp: getTimestamp() };
  }

  @Get('metrics/history/retention')
  @ApiOperation({ summary: 'Get current retention policy' })
  getRetentionPolicy(): ApiResponse<any> {
    const data = { policy: this.historyStorage.getRetentionPolicy() };
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Put('metrics/history/retention/:policy')
  @ApiOperation({ summary: 'Set retention policy (1d, 1w, 1m, 3m, 6m, 1y)' })
  updateRetentionPolicy(@Param('policy') policy: string): ApiResponse<any> {
    return this.applyRetentionPolicy(policy);
  }

  /**
   * @deprecated State-changing GET kept only for existing clients; use PUT instead.
   */
  @Get('metrics/history/retention/:policy')
  @ApiOperation({ summary: 'Deprecated: use PUT. Set retention policy', deprecated: true })
  setRetentionPolicy(@Param('policy') policy: string): ApiResponse<any> {
    return this.applyRetentionPolicy(policy);
  }

  private applyRetentionPolicy(policy: string): ApiResponse<any> {
    if (!RETENTION_POLICIES.includes(policy)) {
      throw new BadRequestException(`policy must be one of: ${RETENTION_POLICIES.join(', ')}`);
    }
    this.historyStorage.setRetentionPolicy(policy);
    const data = { policy: this.historyStorage.getRetentionPolicy() };
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('socket/status')
  @ApiOperation({ summary: 'Get Socket.IO connection status' })
  getSocketStatus(): ApiResponse<any> {
    const data = {
      connectedClients: this.gateway.getConnectedClients(),
      status: this.gateway.getStatus(),
    };
    return { success: true, data, timestamp: getTimestamp() };
  }
}
