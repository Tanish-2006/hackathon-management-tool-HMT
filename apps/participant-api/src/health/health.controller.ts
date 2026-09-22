import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async checkHealth() {
    return this.healthService.getHealth();
  }

  @Get('live')
  async checkLive() {
    return this.healthService.getHealth();
  }

  @Get('readiness')
  async checkReadiness() {
    return this.healthService.getReadiness();
  }

  @Get('ready')
  async checkReady() {
    return this.healthService.getReadiness();
  }
}
