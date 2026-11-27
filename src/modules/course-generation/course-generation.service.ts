import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import {
  CourseGenerationScope,
  CourseGenerationStatus,
  LearningFormat,
  LessonType,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertActiveCrop } from '../crops/crop.lookup';
import { RoleCode } from '../roles/rbac.constants';
import type {
  ChapterOutlineDto,
  CourseGenerationResponseDto,
  CreateCourseGenerationDto,
  ListCourseGenerationsQueryDto,
} from './dto/course-generation.dto';

/** Shown on new requests until the course-generation model is connected. */
export const WAITING_FOR_MODEL =
  'Waiting for the course-generation model. The structure is saved; content is written once the AI model is connected.';

const requestSelect = {
  id: true,
  scope: true,
  status: true,
  statusMessage: true,
  brief: true,
  structure: true,
  contentFormats: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { id: true, title: true, status: true } },
  requestedBy: { select: { id: true, fullName: true } },
  sources: { select: { source: { select: { id: true, title: true } } } },
} satisfies Prisma.CourseGenerationRequestSelect;

type RequestRecord = Prisma.CourseGenerationRequestGetPayload<{ select: typeof requestSelect }>;

function toResponse(row: RequestRecord): CourseGenerationResponseDto {
  const { structure, sources, ...rest } = row;
  return {
    ...rest,
    chapters: (Array.isArray(structure) ? structure : []) as unknown as ChapterOutlineDto[],
    knowledgeSources: sources.map(({ source }) => source),
  };
}

const isAdmin = (actor: AuthenticatedUser) => actor.roles.includes(RoleCode.Admin);

/**
 * Course generation requests. Saving a request creates the course skeleton the requester
 * designed (chapters = modules, sub-chapters = lessons) as a draft; the AI model writes the
 * content later and moves the request to COMPLETED. Until the model is integrated, requests
 * stay PENDING and the course cannot be published.
 */
@Injectable()
export class CourseGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCourseGenerationDto, actor: AuthenticatedUser): Promise<CourseGenerationResponseDto> {
    const scope = this.resolveScope(actor);
    await assertActiveCrop(this.prisma, dto.cropId);
    const sourceIds = dto.knowledgeSourceIds ?? [];
    if (sourceIds.length) {
      const usable = await this.prisma.knowledgeSource.count({
        where: { id: { in: sourceIds }, approvedVersionId: { not: null }, isActive: true, archivedAt: null },
      });
      if (usable !== sourceIds.length) {
        throw new BadRequestException('Only approved, active Knowledge Base sources can be used');
      }
    }

    const formats = [...new Set<LearningFormat>([LearningFormat.TEXT, ...dto.contentFormats])];
    const lessonType = formats.length > 1 ? LessonType.MIXED : LessonType.TEXT;
    const language = dto.language ?? 'rw';
    const totalSubChapters = dto.chapters.reduce((sum, chapter) => sum + chapter.subChapters.length, 0);
    const minutesPerSubChapter = Math.max(1, Math.floor(dto.estimatedDurationMinutes / totalSubChapters));
    const structure = dto.chapters.map((chapter) => ({
      title: chapter.title,
      ...(chapter.description ? { description: chapter.description } : {}),
      subChapters: chapter.subChapters.map((sub) => ({
        title: sub.title,
        ...(sub.description ? { description: sub.description } : {}),
      })),
    }));

    const id = await this.prisma.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          title: dto.title,
          shortDescription: dto.shortDescription,
          detailedDescription: dto.brief,
          cropId: dto.cropId,
          category: dto.category,
          targetAudience: dto.targetAudience,
          difficulty: dto.difficulty,
          learningObjectives: dto.learningObjectives,
          estimatedDurationMinutes: dto.estimatedDurationMinutes,
          language,
          createdById: actor.id,
          facilitatorOwnerId: scope.scope === CourseGenerationScope.GROUP ? actor.id : null,
        },
        select: { id: true },
      });
      for (const [chapterIndex, chapter] of dto.chapters.entries()) {
        await tx.courseModule.create({
          data: {
            courseId: course.id,
            title: chapter.title,
            description: chapter.description ?? null,
            displayOrder: chapterIndex,
            lessons: {
              create: chapter.subChapters.map((sub, subIndex) => ({
                title: sub.title,
                description: sub.description ?? null,
                lessonType,
                language,
                estimatedDurationMinutes: minutesPerSubChapter,
                displayOrder: subIndex,
              })),
            },
          },
        });
      }
      const request = await tx.courseGenerationRequest.create({
        data: {
          courseId: course.id,
          scope: scope.scope,
          brief: dto.brief,
          structure: structure as unknown as Prisma.InputJsonValue,
          contentFormats: formats,
          statusMessage: WAITING_FOR_MODEL,
          requestedById: actor.id,
          sources: { create: sourceIds.map((sourceId) => ({ sourceId })) },
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'course-generation.request',
          entityType: 'CourseGenerationRequest',
          entityId: request.id,
          details: { courseId: course.id, scope: scope.scope, chapters: dto.chapters.length, subChapters: totalSubChapters },
        },
        tx,
      );
      return request.id;
    });
    return this.findOne(id, actor);
  }

  async list(query: ListCourseGenerationsQueryDto, actor: AuthenticatedUser): Promise<Paginated<CourseGenerationResponseDto>> {
    const where: Prisma.CourseGenerationRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(isAdmin(actor) ? {} : { requestedById: actor.id }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.courseGenerationRequest.findMany({
        where,
        select: requestSelect,
        orderBy: { createdAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.courseGenerationRequest.count({ where }),
    ]);
    return paginated(rows.map(toResponse), total, query);
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<CourseGenerationResponseDto> {
    const row = await this.prisma.courseGenerationRequest.findUnique({ where: { id }, select: requestSelect });
    if (!row || (!isAdmin(actor) && row.requestedBy.id !== actor.id)) {
      throw new NotFoundException('Course generation request not found');
    }
    return toResponse(row);
  }

  /** Stops a request that has not started. The draft course and its structure are kept. */
  async cancel(id: string, actor: AuthenticatedUser): Promise<CourseGenerationResponseDto> {
    const current = await this.findOne(id, actor);
    const { count } = await this.prisma.courseGenerationRequest.updateMany({
      where: { id, status: CourseGenerationStatus.PENDING },
      data: { status: CourseGenerationStatus.CANCELLED, statusMessage: 'Cancelled before generation started' },
    });
    if (count === 0) {
      throw new ConflictException(`Only a pending request can be cancelled (this one is ${current.status})`);
    }
    await this.audit.record({
      actorId: actor.id,
      action: 'course-generation.cancel',
      entityType: 'CourseGenerationRequest',
      entityId: id,
    });
    return this.findOne(id, actor);
  }

  /** Administrators generate platform courses; facilitators generate their own group courses. */
  private resolveScope(actor: AuthenticatedUser): { scope: CourseGenerationScope } {
    if (isAdmin(actor)) return { scope: CourseGenerationScope.PLATFORM };
    if (actor.roles.includes(RoleCode.Facilitator)) return { scope: CourseGenerationScope.GROUP };
    throw new ForbiddenException('Only administrators and facilitators can generate courses');
  }
}
