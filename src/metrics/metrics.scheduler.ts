import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class MetricsScheduler implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly loggerService: LoggerService,
  ) {}

  onModuleInit(): void {
    this.loggerService.log('Starting metrics collection scheduler', 'MetricsScheduler');
    this.metricsService.startCollecting();
  }

  onModuleDestroy(): void {
    this.loggerService.log('Stopping metrics collection scheduler', 'MetricsScheduler');
    this.metricsService.stopCollecting();
  }
}
