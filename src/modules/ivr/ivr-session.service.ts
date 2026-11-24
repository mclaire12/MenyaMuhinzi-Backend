import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  TelephonyEndReason,
  TelephonySessionStatus,
  type IvrSession,
  type Prisma,
} from '../../generated/prisma/client';
import {
  paginated,
  paginationArgs,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { REDIS_IVR_SESSION_PREFIX } from '../telephony/telephony.constants';
import type { IvrSessionState } from './menus/ivr-menu.engine';

const sessionSelect = {
  id: true,
  providerId: true,
  providerSessionId: true,
  callSid: true,
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
} satisfies Prisma.IvrSessionSelect;

@Injectable()
export class IvrSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findActive(providerId: string, providerSessionId: string): Promise<IvrSession | null> {
    return this.prisma.ivrSession.findUnique({
      where: { providerId_providerSessionId: { providerId, providerSessionId } },
    });
  }

  async create(input: {
    providerId: string;
    providerSessionId: string;
    callSid?: string;
    phoneNumber: string;
    userId: string | null;
    language: IvrSession['language'];
    state: IvrSessionState;
    isTestData: boolean;
    ttlSeconds: number;
  }): Promise<IvrSession> {
    const session = await this.prisma.ivrSession.create({
      data: {
        providerId: input.providerId,
        providerSessionId: input.providerSessionId,
        callSid: input.callSid,
        phoneNumber: input.phoneNumber,
        userId: input.userId,
        language: input.language,
        menuCode: input.state.menuCode,
        state: input.state as unknown as Prisma.InputJsonValue,
        isTestData: input.isTestData,
      },
    });
    await this.redis.setJson(
      `${REDIS_IVR_SESSION_PREFIX}${session.id}`,
      input.state,
      input.ttlSeconds,
    );
    return session;
  }

  async touch(
    session: IvrSession,
    input: {
      menuCode: string;
      state: IvrSessionState;
      inputHash?: string;
      ttlSeconds: number;
      learningSessionId?: string | null;
    },
  ): Promise<IvrSession> {
    const updated = await this.prisma.ivrSession.update({
      where: { id: session.id },
      data: {
        menuCode: input.menuCode,
        state: input.state as unknown as Prisma.InputJsonValue,
        lastActivityAt: new Date(),
        requestCount: { increment: 1 },
        lastInputHash: input.inputHash,
        language: input.state.language,
        learningSessionId: input.learningSessionId,
      },
    });
    await this.redis.setJson(
      `${REDIS_IVR_SESSION_PREFIX}${session.id}`,
      input.state,
      input.ttlSeconds,
    );
    return updated;
  }

  async end(
    sessionId: string,
    reason: TelephonyEndReason,
    status: TelephonySessionStatus = TelephonySessionStatus.ENDED,
  ): Promise<void> {
    await this.prisma.ivrSession.update({
      where: { id: sessionId },
      data: { status, endReason: reason, endedAt: new Date() },
    });
    await this.redis.del(`${REDIS_IVR_SESSION_PREFIX}${sessionId}`);
  }

  isExpired(session: IvrSession, ttlSeconds: number, now = new Date()): boolean {
    return now.getTime() - session.lastActivityAt.getTime() > ttlSeconds * 1000;
  }

  isDuplicate(session: IvrSession, inputHash?: string): boolean {
    return Boolean(inputHash && session.lastInputHash && session.lastInputHash === inputHash);
  }

  hashInput(providerId: string, providerSessionId: string, requestId: string): string {
    return createHash('sha256')
      .update(`${providerId}:${providerSessionId}:${requestId}`)
      .digest('hex');
  }

  async list(
    query: PaginationQueryDto & { status?: TelephonySessionStatus; phoneNumber?: string },
  ): Promise<Paginated<Prisma.IvrSessionGetPayload<{ select: typeof sessionSelect }>>> {
    const where: Prisma.IvrSessionWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.phoneNumber) where.phoneNumber = query.phoneNumber;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ivrSession.findMany({
        where,
        select: sessionSelect,
        orderBy: { startedAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.ivrSession.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async get(id: string): Promise<IvrSession> {
    const session = await this.prisma.ivrSession.findUnique({
      where: { id },
      select: sessionSelect,
    });
    if (!session) throw new NotFoundException('IVR session not found');
    return session;
  }

  async terminate(id: string): Promise<IvrSession> {
    const session = await this.get(id);
    if (session.status !== TelephonySessionStatus.ACTIVE) return session;
    await this.end(id, TelephonyEndReason.ADMIN_TERMINATED);
    return this.get(id);
  }

  parseState(session: IvrSession): IvrSessionState {
    const raw = session.state as unknown as IvrSessionState;
    return {
      language: raw.language ?? session.language ?? 'rw',
      menuCode: raw.menuCode ?? (session.menuCode as IvrSessionState['menuCode']),
      lessonId: raw.lessonId,
      courseId: raw.courseId,
      courseCompleted: raw.courseCompleted,
      moduleId: raw.moduleId,
      learningSessionId: raw.learningSessionId,
      coursePage: raw.coursePage,
      modulePage: raw.modulePage,
      lessonPage: raw.lessonPage,
      courseOptions: raw.courseOptions,
      moduleOptions: raw.moduleOptions,
      lessonOptions: raw.lessonOptions,
    };
  }
}
