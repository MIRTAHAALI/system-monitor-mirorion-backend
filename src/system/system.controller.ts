import { Controller, Get, Param, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { SystemService } from './system.service';
import { LoggerService } from '../logger/logger.service';
import { getTimestamp } from '../common/utils/metrics.util';
import { ApiResponse } from './system.types';

const MAX_PROCESS_LIMIT = 1000;
const MAX_SEARCH_LENGTH = 200;
const PROCESS_SORTS = ['cpu', 'memory'];

function parseProcessLimit(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_PROCESS_LIMIT);
}

function parseProcessSort(value: string | undefined): string {
  if (value === undefined || value === '') return 'cpu';
  if (!PROCESS_SORTS.includes(value)) {
    throw new BadRequestException(`sort must be one of: ${PROCESS_SORTS.join(', ')}`);
  }
  return value;
}

@ApiTags('System')
@Controller('api/v1')
export class SystemController {
  private readonly logger: any;

  constructor(
    private readonly systemService: SystemService,
    private readonly loggerService: LoggerService,
  ) {
    this.logger = loggerService.child('SystemController');
  }

  @Get('system/info')
  @ApiOperation({ summary: 'Get system information' })
  async getSystemInfo(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getSystemInfo();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('system/metrics')
  @ApiOperation({ summary: 'Get current system metrics snapshot' })
  async getSystemMetrics(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getMetricsSnapshot();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('cpu')
  @ApiOperation({ summary: 'Get CPU metrics' })
  async getCpuMetrics(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getCpuMetrics();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('memory')
  @ApiOperation({ summary: 'Get memory metrics' })
  async getMemoryMetrics(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getMemoryMetrics();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('disk')
  @ApiOperation({ summary: 'Get disk metrics' })
  async getDiskMetrics(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getDiskMetrics();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('network')
  @ApiOperation({ summary: 'Get network metrics' })
  async getNetworkMetrics(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getNetworkMetrics();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('network/status')
  @ApiOperation({ summary: 'Get network connectivity status' })
  async getNetworkStatus(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getNetworkMetrics();
    return { success: true, data: data.status, timestamp: getTimestamp() };
  }

  @Get('processes')
  @ApiOperation({ summary: 'Get running processes' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sort', required: false, enum: ['cpu', 'memory'] })
  @ApiQuery({ name: 'search', required: false, type: String })
  async getProcesses(
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('search') search?: string,
  ): Promise<ApiResponse<any>> {
    if (search !== undefined && (typeof search !== 'string' || search.length > MAX_SEARCH_LENGTH)) {
      throw new BadRequestException(`search must be at most ${MAX_SEARCH_LENGTH} characters`);
    }
    const data = await this.systemService.getProcesses(
      parseProcessLimit(limit, 50),
      parseProcessSort(sort),
      search,
    );
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('processes/top')
  @ApiOperation({ summary: 'Get top processes by resource usage' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sort', required: false, enum: ['cpu', 'memory'] })
  async getTopProcesses(
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ): Promise<ApiResponse<any>> {
    const data = await this.systemService.getProcesses(
      parseProcessLimit(limit, 10),
      parseProcessSort(sort),
    );
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('processes/:pid')
  @ApiOperation({ summary: 'Get process details by PID' })
  @ApiParam({ name: 'pid', type: Number })
  async getProcessDetails(@Param('pid') pid: string): Promise<ApiResponse<any>> {
    const pidNum = Number(pid);
    if (!Number.isInteger(pidNum) || pidNum < 0) {
      throw new BadRequestException('pid must be a non-negative integer');
    }
    const process = await this.systemService.getProcessByPid(pidNum);
    if (!process) {
      throw new NotFoundException(`Process with PID ${pidNum} not found`);
    }
    return { success: true, data: process, timestamp: getTimestamp() };
  }

  @Get('battery')
  @ApiOperation({ summary: 'Get battery information' })
  async getBattery(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getBattery();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('gpu')
  @ApiOperation({ summary: 'Get GPU information' })
  async getGpu(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getGpu();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('temperature')
  @ApiOperation({ summary: 'Get temperature sensor data' })
  async getTemperature(): Promise<ApiResponse<any>> {
    const data = await this.systemService.getTemperature();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('runtime')
  @ApiOperation({ summary: 'Get Node.js runtime information' })
  getRuntime(): ApiResponse<any> {
    const data = this.systemService.getRuntimeInfo();
    return { success: true, data, timestamp: getTimestamp() };
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  getHealth(): ApiResponse<any> {
    const data = this.systemService.getHealth();
    return { success: true, data, timestamp: getTimestamp() };
  }
}
