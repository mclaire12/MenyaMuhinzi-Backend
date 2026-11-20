import { Injectable } from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import { AiUsageStatus, type Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { toUsageResponse } from '../conversations/ai.mappers';
import type {
  UsageFilterQueryDto,
  UsageRecordResponseDto,
  UsageSummaryResponseDto,
} from '../dto/usage.dto';

/** Usage figures are only what providers reported; missing values stay null in totals. */
@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: UsageFilterQueryDto): Promise<Paginated<UsageRecordResponseDto>> {
    const where = this.where(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiUsageRecord.count({ where }),
      this.prisma.aiUsageRecord.findMany({
        where,
        orderBy: [{ recordedAt: 'desc' }, { id: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(rows.map(toUsageResponse), total, query);
  }

  async summary(query: UsageFilterQueryDto): Promise<UsageSummaryResponseDto> {
    const where = this.where(query);
    const [totals, byStatus, costs, byAssistant, byProvider] = await Promise.all([
      this.prisma.aiUsageRecord.aggregate({
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      this.prisma.aiUsageRecord.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.aiUsageRecord.groupBy({
        by: ['currency'],
        where: { ...where, estimatedCost: { not: null }, currency: { not: null } },
        _sum: { estimatedCost: true },
        orderBy: { currency: 'asc' },
      }),
      this.prisma.aiUsageRecord.groupBy({
        by: ['assistantId'],
        where,
        _count: { _all: true },
        _sum: { totalTokens: true },
        orderBy: { assistantId: 'asc' },
      }),
      this.prisma.aiUsageRecord.groupBy({
        by: ['provider'],
        where,
        _count: { _all: true },
        _sum: { totalTokens: true },
        orderBy: { provider: 'asc' },
      }),
    ]);
    const countFor = (status: AiUsageStatus) =>
      byStatus.find((group) => group.status === status)?._count._all ?? 0;
    return {
      records: totals._count._all,
      recorded: countFor(AiUsageStatus.RECORDED),
      notAvailable: countFor(AiUsageStatus.NOT_AVAILABLE),
      inputTokens: totals._sum.inputTokens,
      outputTokens: totals._sum.outputTokens,
      totalTokens: totals._sum.totalTokens,
      costs: costs.map((group) => ({
        currency: group.currency!,
        amount: group._sum.estimatedCost?.toFixed(6) ?? '0.000000',
      })),
      byAssistant: byAssistant.map((group) => ({
        key: group.assistantId,
        records: group._count._all,
        totalTokens: group._sum.totalTokens,
      })),
      byProvider: byProvider.map((group) => ({
        key: group.provider ?? 'unknown',
        records: group._count._all,
        totalTokens: group._sum.totalTokens,
      })),
    };
  }

  private where(query: UsageFilterQueryDto): Prisma.AiUsageRecordWhereInput {
    return {
      ...(query.assistantId ? { assistantId: query.assistantId } : {}),
      ...(query.modelId ? { modelId: query.modelId } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            recordedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
  }
}
