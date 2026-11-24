import { Injectable } from '@nestjs/common';
import { TelephonySessionStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { IvrAnalyticsResponseDto } from './dto/ivr.dto';

@Injectable()
export class IvrAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(): Promise<IvrAnalyticsResponseDto> {
    const [total, active, testSessions] = await Promise.all([
      this.prisma.ivrSession.count(),
      this.prisma.ivrSession.count({ where: { status: TelephonySessionStatus.ACTIVE } }),
      this.prisma.ivrSession.count({ where: { isTestData: true } }),
    ]);
    return {
      totalSessions: total,
      activeSessions: active,
      audioUnavailableCallbacks: testSessions,
    };
  }
}