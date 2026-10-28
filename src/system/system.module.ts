import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { SystemGateway } from './system.gateway';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [LoggerModule],
  controllers: [SystemController],
  providers: [SystemService, SystemGateway],
  exports: [SystemService, SystemGateway],
})
export class SystemModule {}
