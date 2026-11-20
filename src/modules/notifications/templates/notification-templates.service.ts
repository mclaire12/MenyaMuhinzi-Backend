import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import {
  Language,
  NotificationChannel,
  NotificationTemplateStatus,
  Prisma,
  type NotificationCategory,
  type NotificationTemplateVersion,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  renderText,
  validateDefinitions,
  validateVariables,
  type VariableDefinition,
} from '../common/template-renderer';
import type {
  CreateTemplateDto,
  CreateTemplateVersionDto,
  ListTemplatesQueryDto,
  PreviewTemplateDto,
  SetCurrentVersionDto,
  TemplateHistoryResponseDto,
  TemplatePreviewResponseDto,
  TemplateResponseDto,
  TemplateVersionResponseDto,
  UpdateTemplateDto,
} from '../dto/template.dto';
import {
  CHANNEL_CONTENT_RULES,
  NotificationAuditAction,
  NotificationAuditEntity,
} from '../notifications.constants';
import { NotificationSettingsService } from '../settings/notification-settings.service';

const templateInclude = { currentVersion: true } satisfies Prisma.NotificationTemplateInclude;
type TemplateRecord = Prisma.NotificationTemplateGetPayload<{ include: typeof templateInclude }>;
type Tx = Prisma.TransactionClient;

/** Thrown when variables do not satisfy a template's definitions. */
export class NotificationRenderError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
    this.name = 'NotificationRenderError';
  }
}

export interface ResolvedTemplate {
  templateId: string;
  language: Language;
  category: NotificationCategory;
  version: NotificationTemplateVersion;
}

export interface RenderedContent {
  subject: string | null;
  body: string;
}

/**
 * Multilingual templates, one per code, channel and language. Text is written by people:
 * nothing here translates, and a missing language is never created automatically.
 */
@Injectable()
export class NotificationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: NotificationSettingsService,
  ) {}

  async create(dto: CreateTemplateDto, actor: AuthenticatedUser): Promise<TemplateResponseDto> {
    this.assertContent(dto.channel, dto.subject, dto.body, dto.variables);
    await this.assertCategoryAllowsChannel(dto.category, dto.channel);
    const row = await this.prisma.$transaction(async (tx) => {
      const template = await tx.notificationTemplate.create({
        data: {
          code: dto.code,
          channel: dto.channel,
          language: dto.language,
          name: dto.name,
          description: dto.description,
          category: dto.category,
          latestVersionNumber: 1,
          createdById: actor.id,
        },
      });
      const version = await this.createVersion(tx, template.id, 1, dto, actor.id);
      const updated = await tx.notificationTemplate.update({
        where: { id: template.id },
        data: { currentVersionId: version.id },
        include: templateInclude,
      });
      await this.record(tx, actor, NotificationAuditAction.TemplateCreated, template.id, {
        code: dto.code,
        channel: dto.channel,
        language: dto.language,
        category: dto.category,
        versionId: version.id,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async list(query: ListTemplatesQueryDto): Promise<Paginated<TemplateResponseDto>> {
    const where: Prisma.NotificationTemplateWhereInput = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.language ? { language: query.language } : {}),
      ...(query.category ? { category: query.category } : {}),
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
      this.prisma.notificationTemplate.count({ where }),
      this.prisma.notificationTemplate.findMany({
        where,
        include: templateInclude,
        orderBy: [{ code: 'asc' }, { channel: 'asc' }, { language: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(
      rows.map((row) => this.toResponse(row)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<TemplateResponseDto> {
    return this.toResponse(await this.require(id));
  }

  async update(
    id: string,
    dto: UpdateTemplateDto,
    actor: AuthenticatedUser,
  ): Promise<TemplateResponseDto> {
    const current = await this.requireEditable(id);
    if (dto.category) await this.assertCategoryAllowsChannel(dto.category, current.channel);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.notificationTemplate.update({
        where: { id },
        data: { name: dto.name, description: dto.description, category: dto.category },
        include: templateInclude,
      });
      await this.record(tx, actor, NotificationAuditAction.TemplateUpdated, id, {
        fields: Object.keys(dto),
      });
      return updated;
    });
    return this.toResponse(row);
  }

  /** Adds an immutable version; earlier versions stay readable and stay referenced by deliveries. */
  async addVersion(
    id: string,
    dto: CreateTemplateVersionDto,
    actor: AuthenticatedUser,
  ): Promise<TemplateVersionResponseDto> {
    const template = await this.requireEditable(id);
    this.assertContent(template.channel, dto.subject, dto.body, dto.variables);
    const { version, currentVersionId } = await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.notificationTemplate.update({
        where: { id },
        data: { latestVersionNumber: { increment: 1 } },
        select: { latestVersionNumber: true },
      });
      const created = await this.createVersion(tx, id, bumped.latestVersionNumber, dto, actor.id);
      const updated = dto.makeCurrent
        ? await tx.notificationTemplate.update({
            where: { id },
            data: { currentVersionId: created.id },
            select: { currentVersionId: true },
          })
        : { currentVersionId: template.currentVersionId };
      await this.record(tx, actor, NotificationAuditAction.TemplateVersionAdded, id, {
        versionId: created.id,
        versionNumber: created.versionNumber,
        madeCurrent: dto.makeCurrent ?? false,
      });
      return { version: created, currentVersionId: updated.currentVersionId };
    });
    return this.toVersion(version, currentVersionId);
  }

  async listVersions(id: string): Promise<TemplateVersionResponseDto[]> {
    const template = await this.require(id);
    const versions = await this.prisma.notificationTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { versionNumber: 'desc' },
    });
    return versions.map((version) => this.toVersion(version, template.currentVersionId));
  }

  async findVersion(id: string, versionId: string): Promise<TemplateVersionResponseDto> {
    const template = await this.require(id);
    const version = await this.prisma.notificationTemplateVersion.findFirst({
      where: { id: versionId, templateId: id },
    });
    if (!version) throw new NotFoundException('Template version not found');
    return this.toVersion(version, template.currentVersionId);
  }

  async setCurrentVersion(
    id: string,
    dto: SetCurrentVersionDto,
    actor: AuthenticatedUser,
  ): Promise<TemplateResponseDto> {
    await this.requireEditable(id);
    const version = await this.prisma.notificationTemplateVersion.findFirst({
      where: { id: dto.versionId, templateId: id },
      select: { id: true, versionNumber: true },
    });
    if (!version) throw new BadRequestException('versionId must be a version of this template');
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.notificationTemplate.update({
        where: { id },
        data: { currentVersionId: version.id },
        include: templateInclude,
      });
      await this.record(tx, actor, NotificationAuditAction.TemplateCurrentVersionSet, id, {
        versionId: version.id,
        versionNumber: version.versionNumber,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async history(id: string): Promise<TemplateHistoryResponseDto> {
    const versions = await this.listVersions(id);
    const audit = await this.audit.list(NotificationAuditEntity.Template, [id]);
    return { versions, audit };
  }

  activate(id: string, actor: AuthenticatedUser): Promise<TemplateResponseDto> {
    return this.changeStatus(
      id,
      NotificationTemplateStatus.ACTIVE,
      NotificationAuditAction.TemplateActivated,
      actor,
    );
  }

  deactivate(id: string, actor: AuthenticatedUser): Promise<TemplateResponseDto> {
    return this.changeStatus(
      id,
      NotificationTemplateStatus.INACTIVE,
      NotificationAuditAction.TemplateDeactivated,
      actor,
    );
  }

  archive(id: string, actor: AuthenticatedUser): Promise<TemplateResponseDto> {
    return this.changeStatus(
      id,
      NotificationTemplateStatus.ARCHIVED,
      NotificationAuditAction.TemplateArchived,
      actor,
    );
  }

  /** Renders a version with sample values. Nothing is stored or sent. */
  async preview(id: string, dto: PreviewTemplateDto): Promise<TemplatePreviewResponseDto> {
    const template = await this.require(id);
    const version = dto.versionId
      ? await this.prisma.notificationTemplateVersion.findFirst({
          where: { id: dto.versionId, templateId: id },
        })
      : template.currentVersion;
    if (!version) throw new NotFoundException('Template version not found');
    try {
      const rendered = this.render(version, template.channel, dto.variables, false);
      return {
        channel: template.channel,
        language: template.language,
        versionId: version.id,
        ...rendered,
        notice: 'Preview only: nothing was sent.',
      };
    } catch (error) {
      if (error instanceof NotificationRenderError) {
        throw new BadRequestException({
          message: error.problems,
          error: 'Bad Request',
          statusCode: 400,
        });
      }
      throw error;
    }
  }

  /**
   * The active template for a code and channel in the first language that has one. Languages are
   * tried in the order given; this picks an existing human-written template and never translates.
   */
  async resolveActive(
    code: string,
    channel: NotificationChannel,
    languages: Language[],
  ): Promise<ResolvedTemplate | null> {
    const rows = await this.prisma.notificationTemplate.findMany({
      where: {
        code,
        channel,
        language: { in: languages },
        status: NotificationTemplateStatus.ACTIVE,
        currentVersionId: { not: null },
      },
      include: templateInclude,
    });
    for (const language of languages) {
      const row = rows.find((candidate) => candidate.language === language);
      if (row?.currentVersion) {
        return {
          templateId: row.id,
          language,
          category: row.category,
          version: row.currentVersion,
        };
      }
    }
    return null;
  }

  /**
   * Validates the values against the version's definitions, then renders. Throws
   * NotificationRenderError listing every problem. With allowExtra, values without a
   * definition are ignored; otherwise they are rejected.
   */
  render(
    version: Pick<NotificationTemplateVersion, 'subject' | 'body' | 'variables'>,
    channel: NotificationChannel,
    values: Record<string, unknown>,
    allowExtra: boolean,
  ): RenderedContent {
    const definitions = version.variables as unknown as VariableDefinition[];
    const problems = validateVariables(definitions, values, { allowExtra });
    if (problems.length > 0) throw new NotificationRenderError(problems);
    const subject = version.subject ? renderText(version.subject, definitions, values) : null;
    const body = renderText(version.body, definitions, values);
    const rule = CHANNEL_CONTENT_RULES[channel];
    if (body.length > rule.maxBody || (subject?.length ?? 0) > rule.maxSubject) {
      throw new NotificationRenderError([`Rendered text exceeds the ${channel} length limit`]);
    }
    return { subject, body };
  }

  // ------------------------------------------------------------------- internals

  private assertContent(
    channel: NotificationChannel,
    subject: string | undefined,
    body: string,
    variables: VariableDefinition[],
  ): void {
    const rule = CHANNEL_CONTENT_RULES[channel];
    const problems: string[] = [];
    if (rule.subject === 'required' && !subject)
      problems.push(`${channel} templates need a subject`);
    if (rule.subject === 'forbidden' && subject)
      problems.push(`${channel} templates cannot have a subject`);
    if (subject && subject.length > rule.maxSubject) {
      problems.push(`${channel} subjects are limited to ${rule.maxSubject} characters`);
    }
    if (body.length > rule.maxBody) {
      problems.push(`${channel} messages are limited to ${rule.maxBody} characters`);
    }
    problems.push(...validateDefinitions(variables, [subject, body]));
    if (problems.length > 0) {
      throw new BadRequestException({ message: problems, error: 'Bad Request', statusCode: 400 });
    }
  }

  private async assertCategoryAllowsChannel(
    category: NotificationCategory,
    channel: NotificationChannel,
  ): Promise<void> {
    const policy = await this.settings.categoryPolicy(category);
    if (!policy.allowedChannels.includes(channel)) {
      throw new BadRequestException(`Category ${category} does not allow the ${channel} channel`);
    }
  }

  private createVersion(
    tx: Tx,
    templateId: string,
    versionNumber: number,
    dto: { subject?: string; body: string; variables: VariableDefinition[]; changeNote?: string },
    createdById: string,
  ): Promise<NotificationTemplateVersion> {
    return tx.notificationTemplateVersion.create({
      data: {
        templateId,
        versionNumber,
        subject: dto.subject ?? null,
        body: dto.body,
        variables: JSON.parse(JSON.stringify(dto.variables)) as Prisma.InputJsonValue,
        changeNote: dto.changeNote,
        createdById,
      },
    });
  }

  private async changeStatus(
    id: string,
    status: NotificationTemplateStatus,
    action: string,
    actor: AuthenticatedUser,
  ): Promise<TemplateResponseDto> {
    const current = await this.requireEditable(id);
    if (current.status === status) return this.toResponse(current);
    if (status === NotificationTemplateStatus.ACTIVE && !current.currentVersionId) {
      throw new ConflictException('A template needs a current version before activation');
    }
    if (status === NotificationTemplateStatus.ARCHIVED && current.isSystem) {
      throw new ConflictException(
        'System templates are used by built-in events and cannot be archived; deactivate instead',
      );
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.notificationTemplate.update({
        where: { id },
        data: {
          status,
          archivedAt: status === NotificationTemplateStatus.ARCHIVED ? new Date() : undefined,
        },
        include: templateInclude,
      });
      await this.record(tx, actor, action, id, { from: current.status, to: status });
      return updated;
    });
    return this.toResponse(row);
  }

  private async require(id: string): Promise<TemplateRecord> {
    const row = await this.prisma.notificationTemplate.findUnique({
      where: { id },
      include: templateInclude,
    });
    if (!row) throw new NotFoundException('Notification template not found');
    return row;
  }

  private async requireEditable(id: string): Promise<TemplateRecord> {
    const row = await this.require(id);
    if (row.status === NotificationTemplateStatus.ARCHIVED) {
      throw new ConflictException('Archived templates cannot be changed');
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
      {
        actorId: actor.id,
        action,
        entityType: NotificationAuditEntity.Template,
        entityId,
        details,
      },
      tx,
    );
  }

  private toVersion(
    version: NotificationTemplateVersion,
    currentVersionId: string | null,
  ): TemplateVersionResponseDto {
    return {
      id: version.id,
      templateId: version.templateId,
      versionNumber: version.versionNumber,
      subject: version.subject,
      body: version.body,
      variables: version.variables as unknown as TemplateVersionResponseDto['variables'],
      changeNote: version.changeNote,
      isCurrent: version.id === currentVersionId,
      createdById: version.createdById,
      createdAt: version.createdAt,
    };
  }

  private toResponse(row: TemplateRecord): TemplateResponseDto {
    return {
      id: row.id,
      code: row.code,
      channel: row.channel,
      language: row.language,
      name: row.name,
      description: row.description,
      category: row.category,
      status: row.status,
      isSystem: row.isSystem,
      currentVersionId: row.currentVersionId,
      latestVersionNumber: row.latestVersionNumber,
      currentVersion: row.currentVersion
        ? this.toVersion(row.currentVersion, row.currentVersionId)
        : null,
      archivedAt: row.archivedAt,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
