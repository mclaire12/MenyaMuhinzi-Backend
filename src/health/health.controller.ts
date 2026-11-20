import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../modules/auth/decorators/auth.decorators';
import { HealthResponseDto, LivenessResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Readiness check: verifies PostgreSQL and Redis connectivity' })
  @ApiOkResponse({ type: HealthResponseDto, description: 'All dependencies are reachable' })
  @ApiServiceUnavailableResponse({
    type: HealthResponseDto,
    description: 'At least one dependency is unreachable',
  })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponseDto> {
    const result = await this.healthService.readiness();
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness check: the process is running and serving requests' })
  @ApiOkResponse({ type: LivenessResponseDto })
  live(): LivenessResponseDto {
    return this.healthService.liveness();
  }
}
