import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsScheduler } from './metrics.scheduler';
import { MetricsController } from './metrics.controller';
import { HistoryStorageService } from './history-storage.service';
import { SystemModule } from '../system/system.module';
import { LoggerModule } from '../logger/logger.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [SystemModule, LoggerModule, ConfigModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsScheduler, HistoryStorageService],
  exports: [MetricsService, HistoryStorageService],
})
export class MetricsModule {}
