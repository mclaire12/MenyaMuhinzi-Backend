import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  TelephonyEndReason,
  TelephonySessionStatus,
  type Prisma,
  type UssdSession,
} from '../../generated/prisma/client';
import {
  paginated,
  paginationArgs,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { REDIS_USSD_SESSION_PREFIX } from '../telephony/telephony.constants';
import type { UssdSessionState } from './menus/ussd-menu.engine';

const sessionSelect = {
  id: true,
  providerId: true,
  providerSessionId: true,
  phoneNumber: true,
  userId: true,
  language: true,
  status: true,
  menuCode: true,
  state: true,
  learningSessionId: true,
  startedAt: true,
  lastActivityAt: true,
  endedAt: true,
  endReason: true,
  requestCount: true,
  lastInputHash: true,
  isTestData: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UssdSessionSelect;

@Injectable()
export class UssdSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findActive(providerId: string, providerSessionId: string): Promise<UssdSession | null> {
    return this.prisma.ussdSession.findUnique({
      where: { providerId_providerSessionId: { providerId, providerSessionId } },
    });
  }

  async create(input: {
    providerId: string;
    providerSessionId: string;
    phoneNumber: string;
    userId: string | null;
    language: UssdSession['language'];
    state: UssdSessionState;
    isTestData: boolean;
    ttlSeconds: number;
  }): Promise<UssdSession> {
    const session = await this.prisma.ussdSession.create({
      data: {
        providerId: input.providerId,
        providerSessionId: input.providerSessionId,
        phoneNumber: input.phoneNumber,
        userId: input.userId,
        language: input.language,
        menuCode: input.state.menuCode,
        state: input.state as unknown as Prisma.InputJsonValue,
        isTestData: input.isTestData,
      },
    });
    await this.cacheSession(session, input.state, input.ttlSeconds);
    return session;
  }

  async touch(
    session: UssdSession,
    input: {
      menuCode: string;
      state: UssdSessionState;
      inputHash?: string;
      ttlSeconds: number;
      learningSessionId?: string | null;
    },
  ): Promise<UssdSession> {
    const updated = await this.prisma.ussdSession.update({
      where: { id: session.id },
      data: {
        menuCode: input.menuCode,
        state: input.state as unknown as Prisma.InputJsonValue,
        lastActivityAt: new Date(),
        requestCount: { increment: 1 },
        lastInputHash: input.inputHash,
        learningSessionId: input.learningSessionId,
        language: input.state.language,
      },
    });
    await this.cacheSession(updated, input.state, input.ttlSeconds);
    return updated;
  }

  async end(
    sessionId: string,
    reason: TelephonyEndReason,
    status: TelephonySessionStatus = TelephonySessionStatus.ENDED,
  ): Promise<void> {
    await this.prisma.ussdSession.update({
      where: { id: sessionId },
      data: { status, endReason: reason, endedAt: new Date() },
    });
    await this.redis.del(`${REDIS_USSD_SESSION_PREFIX}${sessionId}`);
  }

  async expireStale(before: Date): Promise<number> {
    const stale = await this.prisma.ussdSession.findMany({
      where: { status: TelephonySessionStatus.ACTIVE, lastActivityAt: { lt: before } },
      select: { id: true },
    });
    if (stale.length === 0) return 0;
    await this.prisma.ussdSession.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: {
        status: TelephonySessionStatus.EXPIRED,
        endReason: TelephonyEndReason.TIMEOUT,
        endedAt: new Date(),
      },
    });
    for (const row of stale) await this.redis.del(`${REDIS_USSD_SESSION_PREFIX}${row.id}`);
    return stale.length;
  }

  isExpired(session: UssdSession, ttlSeconds: number, now = new Date()): boolean {
    const ageMs = now.getTime() - session.lastActivityAt.getTime();
    return ageMs > ttlSeconds * 1000;
  }

  isDuplicate(session: UssdSession, inputHash?: string): boolean {
    return Boolean(inputHash && session.lastInputHash && session.lastInputHash === inputHash);
  }

  hashInput(providerId: string, providerSessionId: string, requestId: string): string {
    return createHash('sha256')
      .update(`${providerId}:${providerSessionId}:${requestId}`)
      .digest('hex');
  }

  async list(
    query: PaginationQueryDto & { status?: TelephonySessionStatus; phoneNumber?: string },
  ): Promise<Paginated<Prisma.UssdSessionGetPayload<{ select: typeof sessionSelect }>>> {
    const where: Prisma.UssdSessionWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.phoneNumber) where.phoneNumber = query.phoneNumber;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ussdSession.findMany({
        where,
        select: sessionSelect,
        orderBy: { startedAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.ussdSession.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async get(id: string): Promise<UssdSession> {
    const session = await this.prisma.ussdSession.findUnique({
      where: { id },
      select: sessionSelect,
    });
    if (!session) throw new NotFoundException('USSD session not found');
    return session;
  }

  async terminate(id: string): Promise<UssdSession> {
    const session = await this.get(id);
    if (session.status !== TelephonySessionStatus.ACTIVE) return session;
    await this.end(id, TelephonyEndReason.ADMIN_TERMINATED);
    return this.get(id);
  }

  parseState(session: UssdSession): UssdSessionState {
    const raw = session.state as unknown as UssdSessionState;
    return {
      language: raw.language ?? session.language ?? 'rw',
      menuCode: (raw.menuCode ?? session.menuCode) as UssdSessionState['menuCode'],
      courseId: raw.courseId,
      courseCompleted: raw.courseCompleted,
      moduleId: raw.moduleId,
      lessonId: raw.lessonId,
      learningSessionId: raw.learningSessionId,
      assessmentId: raw.assessmentId,
      assessmentAttemptId: raw.assessmentAttemptId,
      assessmentQuestionIndex: raw.assessmentQuestionIndex,
      assessmentAnswers: raw.assessmentAnswers,
      contentPage: raw.contentPage,
      coursePage: raw.coursePage,
      modulePage: raw.modulePage,
      lessonPageNumber: raw.lessonPageNumber,
      courseOptions: raw.courseOptions,
      moduleOptions: raw.moduleOptions,
      lessonOptions: raw.lessonOptions,
      assessmentPage: raw.assessmentPage,
      assessmentOptions: raw.assessmentOptions,
      assessmentQuestions: raw.assessmentQuestions,
    };
  }

  private async cacheSession(
    session: UssdSession,
    state: UssdSessionState,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.setJson(`${REDIS_USSD_SESSION_PREFIX}${session.id}`, state, ttlSeconds);
  }
}
