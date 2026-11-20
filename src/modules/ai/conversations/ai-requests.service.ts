import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import { AiRequestStatus, type Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { AiAuditAction, AiAuditEntity, CANCELLABLE_REQUEST_STATUSES } from '../ai.constants';
import type {
  AdminAiRequestResponseDto,
  AdminListRequestsQueryDto,
  AiRequestResponseDto,
} from '../dto/conversation.dto';
import type { AiJobData } from '../orchestration/ai-orchestrator.service';
import { requestInclude, toAdminRequestResponse, toRequestResponse } from './ai.mappers';

@Injectable()
export class AiRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(QueueName.AiGeneration) private readonly queue: Queue<AiJobData>,
  ) {}

  async findOwn(id: string, actor: AuthenticatedUser): Promise<AiRequestResponseDto> {
    const row = await this.prisma.aiRequest.findFirst({
      where: { id, userId: actor.id },
      include: requestInclude,
    });
    if (!row) throw new NotFoundException('AI request not found');
    return toRequestResponse(row);
  }

  /** Requests can be cancelled until processing starts. */
  async cancel(id: string, actor: AuthenticatedUser): Promise<AiRequestResponseDto> {
    const row = await this.prisma.aiRequest.findFirst({
      where: { id, userId: actor.id },
      select: { status: true },
    });
    if (!row) throw new NotFoundException('AI request not found');
    if (row.status !== AiRequestStatus.CANCELLED) {
      const updated = await this.prisma.aiRequest.updateMany({
        where: { id, status: { in: CANCELLABLE_REQUEST_STATUSES } },
        data: { status: AiRequestStatus.CANCELLED, completedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new ConflictException('Only queued requests can be cancelled');
      }
      try {
        await this.queue.remove(id);
      } catch {
        // The worker skips cancelled requests, so a job that cannot be removed is harmless.
      }
    }
    return this.findOwn(id, actor);
  }

  async adminList(query: AdminListRequestsQueryDto): Promise<Paginated<AdminAiRequestResponseDto>> {
    const where: Prisma.AiRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.assistantId ? { assistantId: query.assistantId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiRequest.count({ where }),
      this.prisma.aiRequest.findMany({
        where,
        include: requestInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(rows.map(toAdminRequestResponse), total, query);
  }

  async adminFindOne(id: string, actor: AuthenticatedUser): Promise<AdminAiRequestResponseDto> {
    const row = await this.prisma.aiRequest.findUnique({ where: { id }, include: requestInclude });
    if (!row) throw new NotFoundException('AI request not found');
    if (row.userId !== actor.id) {
      await this.audit.record({
        actorId: actor.id,
        action: AiAuditAction.RequestViewed,
        entityType: AiAuditEntity.Request,
        entityId: id,
        details: { ownerId: row.userId },
      });
    }
    return toAdminRequestResponse(row);
  }
}
