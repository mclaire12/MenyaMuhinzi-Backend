import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import {
  AiRecordStatus,
  Prisma,
  type AiSafetyPolicyVersion,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { AiAuditAction, AiAuditEntity } from '../ai.constants';
import type {
  CreateSafetyPolicyDto,
  ListSafetyPoliciesQueryDto,
  SafetyPolicyResponseDto,
  SafetyPolicyVersionResponseDto,
  UpdateSafetyPolicyDto,
} from '../dto/safety-policy.dto';

const policyInclude = { currentVersion: true } satisfies Prisma.AiSafetyPolicyInclude;
type PolicyRecord = Prisma.AiSafetyPolicyGetPayload<{ include: typeof policyInclude }>;
type Tx = Prisma.TransactionClient;

const RULE_FIELDS = [
  'instructions',
  'restrictions',
  'triggerKeywords',
  'requiresEscalation',
  'escalationGuidance',
] as const;

/**
 * Safety policies are instructions added to prompts and keywords checked by the response
 * validator. They document intent; on their own they do not make AI output safe.
 */
@Injectable()
export class AiSafetyPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateSafetyPolicyDto,
    actor: AuthenticatedUser,
  ): Promise<SafetyPolicyResponseDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const policy = await tx.aiSafetyPolicy.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description,
          category: dto.category,
          latestVersionNumber: 1,
          createdById: actor.id,
        },
      });
      const version = await tx.aiSafetyPolicyVersion.create({
        data: {
          policyId: policy.id,
          versionNumber: 1,
          instructions: dto.instructions,
          restrictions: dto.restrictions ?? [],
          triggerKeywords: dto.triggerKeywords ?? [],
          requiresEscalation: dto.requiresEscalation ?? false,
          escalationGuidance: dto.escalationGuidance,
          changeNote: dto.changeNote,
          createdById: actor.id,
        },
      });
      const updated = await tx.aiSafetyPolicy.update({
        where: { id: policy.id },
        data: { currentVersionId: version.id },
        include: policyInclude,
      });
      await this.record(tx, actor, AiAuditAction.SafetyPolicyCreated, policy.id, {
        code: policy.code,
        category: policy.category,
        versionId: version.id,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async list(query: ListSafetyPoliciesQueryDto): Promise<Paginated<SafetyPolicyResponseDto>> {
    const where: Prisma.AiSafetyPolicyWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiSafetyPolicy.count({ where }),
      this.prisma.aiSafetyPolicy.findMany({
        where,
        include: policyInclude,
        orderBy: [{ code: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(
      rows.map((row) => this.toResponse(row)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<SafetyPolicyResponseDto> {
    return this.toResponse(await this.require(id));
  }

  /** Metadata changes edit the policy; rule changes add a version that becomes current. */
  async update(
    id: string,
    dto: UpdateSafetyPolicyDto,
    actor: AuthenticatedUser,
  ): Promise<SafetyPolicyResponseDto> {
    const current = await this.requireEditable(id);
    const rulesChanged = RULE_FIELDS.some((field) => dto[field] !== undefined);
    const row = await this.prisma.$transaction(async (tx) => {
      let versionId: string | undefined;
      let versionNumber: number | undefined;
      if (rulesChanged) {
        const base = current.currentVersion;
        const bumped = await tx.aiSafetyPolicy.update({
          where: { id },
          data: { latestVersionNumber: { increment: 1 } },
          select: { latestVersionNumber: true },
        });
        const version = await tx.aiSafetyPolicyVersion.create({
          data: {
            policyId: id,
            versionNumber: bumped.latestVersionNumber,
            instructions: dto.instructions ?? base?.instructions ?? '',
            restrictions: dto.restrictions ?? base?.restrictions ?? [],
            triggerKeywords: dto.triggerKeywords ?? base?.triggerKeywords ?? [],
            requiresEscalation: dto.requiresEscalation ?? base?.requiresEscalation ?? false,
            escalationGuidance:
              dto.escalationGuidance !== undefined
                ? dto.escalationGuidance
                : (base?.escalationGuidance ?? null),
            changeNote: dto.changeNote,
            createdById: actor.id,
          },
        });
        versionId = version.id;
        versionNumber = version.versionNumber;
      }
      const updated = await tx.aiSafetyPolicy.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          category: dto.category,
          currentVersionId: versionId,
        },
        include: policyInclude,
      });
      await this.record(tx, actor, AiAuditAction.SafetyPolicyUpdated, id, {
        fields: Object.keys(dto).filter((key) => key !== 'changeNote'),
        ...(versionId ? { versionId, versionNumber } : {}),
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async listVersions(id: string): Promise<SafetyPolicyVersionResponseDto[]> {
    await this.require(id);
    const versions = await this.prisma.aiSafetyPolicyVersion.findMany({
      where: { policyId: id },
      orderBy: { versionNumber: 'desc' },
    });
    return versions.map((version) => this.toVersion(version));
  }

  activate(id: string, actor: AuthenticatedUser): Promise<SafetyPolicyResponseDto> {
    return this.changeStatus(id, AiRecordStatus.ACTIVE, AiAuditAction.SafetyPolicyActivated, actor);
  }

  deactivate(id: string, actor: AuthenticatedUser): Promise<SafetyPolicyResponseDto> {
    return this.changeStatus(
      id,
      AiRecordStatus.INACTIVE,
      AiAuditAction.SafetyPolicyDeactivated,
      actor,
    );
  }

  archive(id: string, actor: AuthenticatedUser): Promise<SafetyPolicyResponseDto> {
    return this.changeStatus(
      id,
      AiRecordStatus.ARCHIVED,
      AiAuditAction.SafetyPolicyArchived,
      actor,
    );
  }

  /** Current versions of all active policies, applied to every request. */
  activeVersions(): Promise<(AiSafetyPolicyVersion & { policy: { code: string } })[]> {
    return this.prisma.aiSafetyPolicyVersion.findMany({
      where: { currentOf: { is: { status: AiRecordStatus.ACTIVE } } },
      include: { policy: { select: { code: true } } },
      orderBy: { policy: { code: 'asc' } },
    });
  }

  private async changeStatus(
    id: string,
    status: AiRecordStatus,
    action: string,
    actor: AuthenticatedUser,
  ): Promise<SafetyPolicyResponseDto> {
    const current = await this.requireEditable(id);
    if (current.status === status) return this.toResponse(current);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiSafetyPolicy.update({
        where: { id },
        data: {
          status,
          archivedAt: status === AiRecordStatus.ARCHIVED ? new Date() : undefined,
        },
        include: policyInclude,
      });
      await this.record(tx, actor, action, id, { from: current.status, to: status });
      return updated;
    });
    return this.toResponse(row);
  }

  private async require(id: string): Promise<PolicyRecord> {
    const row = await this.prisma.aiSafetyPolicy.findUnique({
      where: { id },
      include: policyInclude,
    });
    if (!row) throw new NotFoundException('Safety policy not found');
    return row;
  }

  private async requireEditable(id: string): Promise<PolicyRecord> {
    const row = await this.require(id);
    if (row.status === AiRecordStatus.ARCHIVED) {
      throw new ConflictException('Archived safety policies cannot be changed');
    }
    return row;
  }

  private record(
    tx: Tx,
    actor: AuthenticatedUser,
    action: string,
    entityId: string,
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    return this.audit.record(
      { actorId: actor.id, action, entityType: AiAuditEntity.SafetyPolicy, entityId, details },
      tx,
    );
  }

  private toVersion(version: AiSafetyPolicyVersion): SafetyPolicyVersionResponseDto {
    return {
      id: version.id,
      policyId: version.policyId,
      versionNumber: version.versionNumber,
      instructions: version.instructions,
      restrictions: version.restrictions,
      triggerKeywords: version.triggerKeywords,
      requiresEscalation: version.requiresEscalation,
      escalationGuidance: version.escalationGuidance,
      changeNote: version.changeNote,
      createdById: version.createdById,
      createdAt: version.createdAt,
    };
  }

  private toResponse(row: PolicyRecord): SafetyPolicyResponseDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      category: row.category,
      status: row.status,
      latestVersionNumber: row.latestVersionNumber,
      currentVersion: row.currentVersion ? this.toVersion(row.currentVersion) : null,
      archivedAt: row.archivedAt,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
