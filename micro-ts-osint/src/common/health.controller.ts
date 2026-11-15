import { Controller, Get, Logger } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from './decorators/public.decorator';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  @Get()
  @Public()
  @ApiExcludeEndpoint()
  healthCheck() {
    this.logger.log('❤️  Health check accessed');
    return {
      status: 'UP',
      timestamp: new Date().toISOString(),
      service: 'osint-microservice',
      version: '2.7.0',
    };
  }
}
