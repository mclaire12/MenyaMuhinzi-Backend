import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import { AiRecordStatus, Prisma, type AiPromptVersion } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { AiAuditAction, AiAuditEntity } from '../ai.constants';
import type {
  CreatePromptTemplateDto,
  CreatePromptVersionDto,
  ListPromptTemplatesQueryDto,
  PromptTemplateResponseDto,
  PromptVersionResponseDto,
  SetDefaultPromptVersionDto,
  UpdatePromptTemplateDto,
} from '../dto/prompt.dto';
import { extractVariables } from '../orchestration/prompt-assembler';

const templateInclude = { defaultVersion: true } satisfies Prisma.AiPromptTemplateInclude;
type TemplateRecord = Prisma.AiPromptTemplateGetPayload<{ include: typeof templateInclude }>;
type Tx = Prisma.TransactionClient;

/** Prompt text is stored and versioned only; it is never executed by this service. */
@Injectable()
export class AiPromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreatePromptTemplateDto,
    actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const template = await tx.aiPromptTemplate.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description,
          category: dto.category,
          language: dto.language,
          purpose: dto.purpose,
          latestVersionNumber: 1,
          createdById: actor.id,
        },
      });
      const version = await this.createVersion(
        tx,
        template.id,
        1,
        dto.content,
        dto.changeNote,
        actor,
      );
      const updated = await tx.aiPromptTemplate.update({
        where: { id: template.id },
        data: { defaultVersionId: version.id },
        include: templateInclude,
      });
      await this.record(tx, actor, AiAuditAction.PromptCreated, template.id, {
        code: template.code,
        category: template.category,
        versionId: version.id,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async list(query: ListPromptTemplatesQueryDto): Promise<Paginated<PromptTemplateResponseDto>> {
    const where: Prisma.AiPromptTemplateWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.language ? { language: query.language } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiPromptTemplate.count({ where }),
      this.prisma.aiPromptTemplate.findMany({
        where,
        include: templateInclude,
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

  async findOne(id: string): Promise<PromptTemplateResponseDto> {
    return this.toResponse(await this.require(id));
  }

  async update(
    id: string,
    dto: UpdatePromptTemplateDto,
    actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    await this.requireEditable(id);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiPromptTemplate.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          category: dto.category,
          language: dto.language,
          purpose: dto.purpose,
        },
        include: templateInclude,
      });
      await this.record(tx, actor, AiAuditAction.PromptUpdated, id, { fields: Object.keys(dto) });
      return updated;
    });
    return this.toResponse(row);
  }

  /** Adds a new immutable version; earlier versions are kept and stay referenceable. */
  async addVersion(
    id: string,
    dto: CreatePromptVersionDto,
    actor: AuthenticatedUser,
  ): Promise<PromptVersionResponseDto> {
    await this.requireEditable(id);
    const { version, template } = await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.aiPromptTemplate.update({
        where: { id },
        data: { latestVersionNumber: { increment: 1 } },
        select: { latestVersionNumber: true },
      });
      const created = await this.createVersion(
        tx,
        id,
        bumped.latestVersionNumber,
        dto.content,
        dto.changeNote,
        actor,
      );
      const template = dto.makeDefault
        ? await tx.aiPromptTemplate.update({
            where: { id },
            data: { defaultVersionId: created.id },
            select: { defaultVersionId: true },
          })
        : await tx.aiPromptTemplate.findUniqueOrThrow({
            where: { id },
            select: { defaultVersionId: true },
          });
      await this.record(tx, actor, AiAuditAction.PromptVersionAdded, id, {
        versionId: created.id,
        versionNumber: created.versionNumber,
        madeDefault: dto.makeDefault ?? false,
      });
      return { version: created, template };
    });
    return this.toVersion(version, template.defaultVersionId);
  }

  async listVersions(id: string): Promise<PromptVersionResponseDto[]> {
    const template = await this.require(id);
    const versions = await this.prisma.aiPromptVersion.findMany({
      where: { templateId: id },
      orderBy: { versionNumber: 'desc' },
    });
    return versions.map((version) => this.toVersion(version, template.defaultVersionId));
  }

  async findVersion(id: string, versionId: string): Promise<PromptVersionResponseDto> {
    const template = await this.require(id);
    const version = await this.prisma.aiPromptVersion.findFirst({
      where: { id: versionId, templateId: id },
    });
    if (!version) throw new NotFoundException('Prompt version not found');
    return this.toVersion(version, template.defaultVersionId);
  }

  async setDefaultVersion(
    id: string,
    dto: SetDefaultPromptVersionDto,
    actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    await this.requireEditable(id);
    const version = await this.prisma.aiPromptVersion.findFirst({
      where: { id: dto.versionId, templateId: id },
      select: { id: true, versionNumber: true },
    });
    if (!version) throw new BadRequestException('versionId must be a version of this template');
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiPromptTemplate.update({
        where: { id },
        data: { defaultVersionId: version.id },
        include: templateInclude,
      });
      await this.record(tx, actor, AiAuditAction.PromptDefaultVersionSet, id, {
        versionId: version.id,
        versionNumber: version.versionNumber,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  activate(id: string, actor: AuthenticatedUser): Promise<PromptTemplateResponseDto> {
    return this.changeStatus(id, AiRecordStatus.ACTIVE, AiAuditAction.PromptActivated, actor);
  }

  deactivate(id: string, actor: AuthenticatedUser): Promise<PromptTemplateResponseDto> {
    return this.changeStatus(id, AiRecordStatus.INACTIVE, AiAuditAction.PromptDeactivated, actor);
  }

  /** Archived templates are skipped by requests; their versions are preserved. */
  archive(id: string, actor: AuthenticatedUser): Promise<PromptTemplateResponseDto> {
    return this.changeStatus(id, AiRecordStatus.ARCHIVED, AiAuditAction.PromptArchived, actor);
  }

  private async changeStatus(
    id: string,
    status: AiRecordStatus,
    action: string,
    actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    const current = await this.requireEditable(id);
    if (current.status === status) return this.toResponse(current);
    if (status === AiRecordStatus.ACTIVE && !current.defaultVersionId) {
      throw new ConflictException('A template needs a default version before activation');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiPromptTemplate.update({
        where: { id },
        data: {
          status,
          archivedAt: status === AiRecordStatus.ARCHIVED ? new Date() : undefined,
        },
        include: templateInclude,
      });
      await this.record(tx, actor, action, id, { from: current.status, to: status });
      return updated;
    });
    return this.toResponse(row);
  }

  private createVersion(
    tx: Tx,
    templateId: string,
    versionNumber: number,
    content: string,
    changeNote: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<AiPromptVersion> {
    return tx.aiPromptVersion.create({
      data: {
        templateId,
        versionNumber,
        content,
        variables: extractVariables(content),
        changeNote,
        createdById: actor.id,
      },
    });
  }

  private async require(id: string): Promise<TemplateRecord> {
    const row = await this.prisma.aiPromptTemplate.findUnique({
      where: { id },
      include: templateInclude,
    });
    if (!row) throw new NotFoundException('Prompt template not found');
    return row;
  }

  private async requireEditable(id: string): Promise<TemplateRecord> {
    const row = await this.require(id);
    if (row.status === AiRecordStatus.ARCHIVED) {
      throw new ConflictException('Archived prompt templates cannot be changed');
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
      { actorId: actor.id, action, entityType: AiAuditEntity.Prompt, entityId, details },
      tx,
    );
  }

  private toVersion(
    version: AiPromptVersion,
    defaultVersionId: string | null,
  ): PromptVersionResponseDto {
    return {
      id: version.id,
      templateId: version.templateId,
      versionNumber: version.versionNumber,
      content: version.content,
      variables: version.variables,
      changeNote: version.changeNote,
      isDefault: version.id === defaultVersionId,
      createdById: version.createdById,
      createdAt: version.createdAt,
    };
  }

  private toResponse(row: TemplateRecord): PromptTemplateResponseDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      category: row.category,
      language: row.language,
      purpose: row.purpose,
      status: row.status,
      defaultVersionId: row.defaultVersionId,
      latestVersionNumber: row.latestVersionNumber,
      defaultVersion: row.defaultVersion
        ? this.toVersion(row.defaultVersion, row.defaultVersionId)
        : null,
      archivedAt: row.archivedAt,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
