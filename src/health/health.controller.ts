import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SystemService } from '../system/system.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Health')
@Controller('api/v1')
export class HealthController {
  constructor(private readonly systemService: SystemService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  getHealth() {
    return this.systemService.getHealth();
  }
}
