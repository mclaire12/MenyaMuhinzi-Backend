import { Injectable } from '@nestjs/common';
import { TelephonySessionStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { UssdAnalyticsResponseDto } from './dto/ussd.dto';

@Injectable()
export class UssdAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(): Promise<UssdAnalyticsResponseDto> {
    const [total, active, ended, expired, testSessions] = await Promise.all([
      this.prisma.ussdSession.count(),
      this.prisma.ussdSession.count({ where: { status: TelephonySessionStatus.ACTIVE } }),
      this.prisma.ussdSession.count({ where: { status: TelephonySessionStatus.ENDED } }),
      this.prisma.ussdSession.count({ where: { status: TelephonySessionStatus.EXPIRED } }),
      this.prisma.ussdSession.count({ where: { isTestData: true } }),
    ]);
    return { totalSessions: total, activeSessions: active, endedSessions: ended, expiredSessions: expired, testSessions };
  }
}