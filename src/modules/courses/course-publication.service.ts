import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CourseStatus, Prisma, PublicationScope, RecordStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertCanPublish } from './course-status.policy';
import type { CoursePublicationResponseDto, PublishCourseDto } from './dto/publication.dto';

const publicationSelect = {
  id: true,
  courseId: true,
  scope: true,
  isCurrent: true,
  publishedAt: true,
  unpublishedAt: true,
  publishedBy: { select: { id: true, fullName: true } },
  unpublishedBy: { select: { id: true, fullName: true } },
  targets: { select: { group: { select: { id: true, name: true } } } },
} satisfies Prisma.CoursePublicationSelect;

type PublicationRecord = Prisma.CoursePublicationGetPayload<{ select: typeof publicationSelect }>;

/** Closes the open publication, if there is one. The course status is left to the caller. */
export async function closeCurrentPublication(
  tx: Prisma.TransactionClient,
  courseId: string,
  actorId: string,
): Promise<boolean> {
  const { count } = await tx.coursePublication.updateMany({
    where: { courseId, isCurrent: true },
    data: { isCurrent: false, unpublishedAt: new Date(), unpublishedById: actorId },
  });
  return count > 0;
}

@Injectable()
export class CoursePublicationService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(
    courseId: string,
    dto: PublishCourseDto,
    actor: AuthenticatedUser,
  ): Promise<CoursePublicationResponseDto> {
    if (dto.scope === PublicationScope.PLATFORM && dto.targetingGroupIds?.length) {
      throw new BadRequestException('Platform-wide publication does not take targeting groups');
    }

    return this.prisma.$transaction(async (tx) => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { status: true } });
      if (!course) throw new NotFoundException('Course not found');
      assertCanPublish(course.status);

      const groupIds = dto.scope === PublicationScope.TARGETED ? (dto.targetingGroupIds ?? []) : [];
      if (groupIds.length > 0) {
        const groups = await tx.adminTargetingGroup.findMany({
          where: { id: { in: groupIds }, status: RecordStatus.ACTIVE },
          select: { id: true },
        });
        if (groups.length !== groupIds.length) {
          throw new BadRequestException('One or more targeting groups are missing or inactive');
        }
      }

      const publishedAt = new Date();
      try {
        const publication = await tx.coursePublication.create({
          data: {
            courseId,
            scope: dto.scope,
            publishedById: actor.id,
            publishedAt,
            targets: groupIds.length ? { create: groupIds.map((groupId) => ({ groupId })) } : undefined,
          },
          select: publicationSelect,
        });
        await tx.course.update({
          where: { id: courseId },
          data: { status: CourseStatus.PUBLISHED, publishedAt },
        });
        return toPublication(publication);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Course is already published');
        }
        throw error;
      }
    });
  }

  async unpublish(courseId: string, actor: AuthenticatedUser): Promise<CoursePublicationResponseDto> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { status: true } });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status !== CourseStatus.PUBLISHED) {
      throw new ConflictException('Only a published course can be unpublished');
    }

    return this.prisma.$transaction(async (tx) => {
      const closed = await closeCurrentPublication(tx, courseId, actor.id);
      if (!closed) throw new ConflictException('Only a published course can be unpublished');
      await tx.course.update({
        where: { id: courseId },
        data: { status: CourseStatus.DRAFT, publishedAt: null },
      });
      const publication = await tx.coursePublication.findFirstOrThrow({
        where: { courseId },
        orderBy: { publishedAt: 'desc' },
        select: publicationSelect,
      });
      return toPublication(publication);
    });
  }

  async list(courseId: string): Promise<CoursePublicationResponseDto[]> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) throw new NotFoundException('Course not found');
    const publications = await this.prisma.coursePublication.findMany({
      where: { courseId },
      select: publicationSelect,
      orderBy: { publishedAt: 'desc' },
    });
    return publications.map(toPublication);
  }
}

function toPublication(publication: PublicationRecord): CoursePublicationResponseDto {
  return {
    id: publication.id,
    courseId: publication.courseId,
    scope: publication.scope,
    isCurrent: publication.isCurrent,
    publishedAt: publication.publishedAt,
    unpublishedAt: publication.unpublishedAt,
    publishedBy: publication.publishedBy,
    unpublishedBy: publication.unpublishedBy,
    targetingGroups: publication.targets.map(({ group }) => group),
  };
}
