import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { LoggerModule } from '../logger/logger.module';
import { SystemModule } from '../system/system.module';

@Module({
  imports: [LoggerModule, SystemModule],
  controllers: [HealthController],
})
export class HealthModule {}
