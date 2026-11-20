import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import { Prisma, RecordStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { isAdmin } from '../../groups/facilitator-groups.service';
import type {
  CreateGlossaryTermDto,
  GlossaryTermResponseDto,
  ListGlossaryQueryDto,
  UpdateGlossaryTermDto,
} from '../dto/glossary.dto';
import { AuditEntity, KnowledgeAuditAction } from '../knowledge.constants';

const dedupe = (values: string[] | undefined) => (values ? [...new Set(values)] : undefined);

/** Bilingual terms are entered by administrators. Nothing here translates or generates text. */
@Injectable()
export class GlossaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListGlossaryQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Paginated<GlossaryTermResponseDto>> {
    const and: Prisma.AgriculturalGlossaryTermWhereInput[] = [];
    const status = isAdmin(actor) ? query.status : RecordStatus.ACTIVE;
    if (status) and.push({ status });
    if (query.cropId) and.push({ cropId: query.cropId });
    if (query.topicId) and.push({ topicId: query.topicId });
    if (query.q) {
      const synonymMatches = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM agricultural_glossary_terms
        WHERE array_to_string("synonymsEn" || "synonymsRw", ' ') ILIKE ${`%${escapeLike(query.q)}%`}`;
      and.push({
        OR: [
          { termEn: { contains: query.q, mode: 'insensitive' } },
          { termRw: { contains: query.q, mode: 'insensitive' } },
          { descriptionEn: { contains: query.q, mode: 'insensitive' } },
          { descriptionRw: { contains: query.q, mode: 'insensitive' } },
          { id: { in: synonymMatches.map((row) => row.id) } },
        ],
      });
    }
    const where = { AND: and };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.agriculturalGlossaryTerm.count({ where }),
      this.prisma.agriculturalGlossaryTerm.findMany({
        where,
        orderBy: [{ termEn: 'asc' }, { id: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(rows, total, query);
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<GlossaryTermResponseDto> {
    const term = await this.prisma.agriculturalGlossaryTerm.findFirst({
      where: isAdmin(actor) ? { id } : { id, status: RecordStatus.ACTIVE },
    });
    if (!term) throw new NotFoundException('Glossary term not found');
    return term;
  }

  async create(
    dto: CreateGlossaryTermDto,
    actor: AuthenticatedUser,
  ): Promise<GlossaryTermResponseDto> {
    await this.assertReferences(dto.cropId, dto.topicId);
    await this.assertUnique(dto.termEn, dto.termRw);
    return this.prisma.$transaction(async (tx) => {
      const term = await tx.agriculturalGlossaryTerm.create({
        data: {
          ...dto,
          synonymsEn: dedupe(dto.synonymsEn),
          synonymsRw: dedupe(dto.synonymsRw),
          usageExamples: dedupe(dto.usageExamples),
          createdById: actor.id,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.GlossaryCreated,
          entityType: AuditEntity.Glossary,
          entityId: term.id,
          details: { termEn: term.termEn, termRw: term.termRw },
        },
        tx,
      );
      return term;
    });
  }

  async update(
    id: string,
    dto: UpdateGlossaryTermDto,
    actor: AuthenticatedUser,
  ): Promise<GlossaryTermResponseDto> {
    const current = await this.prisma.agriculturalGlossaryTerm.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Glossary term not found');
    await this.assertReferences(dto.cropId ?? undefined, dto.topicId ?? undefined);
    if (dto.termEn || dto.termRw)
      await this.assertUnique(dto.termEn ?? current.termEn, dto.termRw ?? current.termRw, id);
    return this.prisma.$transaction(async (tx) => {
      const term = await tx.agriculturalGlossaryTerm.update({
        where: { id },
        data: {
          ...dto,
          synonymsEn: dedupe(dto.synonymsEn),
          synonymsRw: dedupe(dto.synonymsRw),
          usageExamples: dedupe(dto.usageExamples),
          updatedById: actor.id,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.GlossaryUpdated,
          entityType: AuditEntity.Glossary,
          entityId: id,
          details: { fields: Object.keys(dto) },
        },
        tx,
      );
      return term;
    });
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<GlossaryTermResponseDto> {
    const current = await this.prisma.agriculturalGlossaryTerm.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!current) throw new NotFoundException('Glossary term not found');
    return this.prisma.$transaction(async (tx) => {
      const term = await tx.agriculturalGlossaryTerm.update({
        where: { id },
        data: { status: RecordStatus.INACTIVE, updatedById: actor.id },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.GlossaryDeactivated,
          entityType: AuditEntity.Glossary,
          entityId: id,
        },
        tx,
      );
      return term;
    });
  }

  private async assertUnique(termEn: string, termRw: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.agriculturalGlossaryTerm.findFirst({
      where: {
        termEn: { equals: termEn, mode: 'insensitive' },
        termRw: { equals: termRw, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException('This English and Kinyarwanda term pair already exists');
  }

  private async assertReferences(cropId?: string, topicId?: string): Promise<void> {
    if (cropId) {
      const crop = await this.prisma.crop.findFirst({
        where: { id: cropId, status: RecordStatus.ACTIVE },
        select: { id: true },
      });
      if (!crop) throw new BadRequestException('Crop is not available');
    }
    if (topicId) {
      const topic = await this.prisma.knowledgeTopic.findFirst({
        where: { id: topicId, status: RecordStatus.ACTIVE },
        select: { id: true },
      });
      if (!topic) throw new BadRequestException('Topic is not available');
    }
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
