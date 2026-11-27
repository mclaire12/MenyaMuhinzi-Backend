import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import {
  CourseStatus,
  Prisma,
  PublicationScope,
  RecordStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertActiveCrop, cropSummarySelect } from '../crops/crop.lookup';
import { isAdmin } from '../groups/facilitator-groups.service';
import { RoleCode } from '../roles/rbac.constants';
import {
  assertCanDeleteCourse,
  assertCourseStatusChange,
  assertGenerationFinished,
} from './course-status.policy';
import type { CourseResponseDto, ListCoursesQueryDto, UpdateCourseDto } from './dto/course.dto';
import {
  audienceAllows,
  audiencesForRoles,
  farmerMatchesTarget,
  groupMatchesTargeting,
  targetingMatchWhere,
  type AreaMatch,
  type FarmerArea,
} from './publication-eligibility';
import { closeCurrentPublication } from './course-publication.service';

const courseSelect = {
  id: true,
  title: true,
  shortDescription: true,
  detailedDescription: true,
  category: true,
  targetAudience: true,
  difficulty: true,
  learningObjectives: true,
  estimatedDurationMinutes: true,
  language: true,
  coverImageRef: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  crop: { select: cropSummarySelect },
  createdBy: { select: { id: true, fullName: true } },
  facilitatorOwner: { select: { id: true, fullName: true } },
  groupCourses: {
    select: { group: { select: { id: true, name: true, facilitatorId: true } } },
    orderBy: { assignedAt: 'asc' },
  },
  generation: { select: { id: true, status: true } },
} satisfies Prisma.CourseSelect;


type CourseRecord = Prisma.CourseGetPayload<{ select: typeof courseSelect }>;

/**
 * Facilitator courses list the groups they are published to; only administrators and the
 * owning facilitator see those group names.
 */
function toCourseResponse(course: CourseRecord, actor: AuthenticatedUser): CourseResponseDto {
  const { groupCourses, ...rest } = course;
  const showGroups =
    !!course.facilitatorOwner && (isAdmin(actor) || course.facilitatorOwner.id === actor.id);
  return {
    ...rest,
    sharedWithGroups: showGroups
      ? groupCourses.map(({ group }) => ({ id: group.id, name: group.name }))
      : [],
  };
}

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCoursesQueryDto, actor: AuthenticatedUser): Promise<Paginated<CourseResponseDto>> {
    const where: Prisma.CourseWhereInput = {};
    if (query.cropId) where.cropId = query.cropId;
    if (query.language) where.language = query.language;
    if (query.category) where.category = query.category;
    if (query.difficulty) where.difficulty = query.difficulty;
    if (query.ownership === 'GROUP') where.facilitatorOwnerId = { not: null };
    if (query.ownership === 'PLATFORM') where.facilitatorOwnerId = null;
    const and: Prisma.CourseWhereInput[] = [];
    if (query.search) {
      and.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { shortDescription: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    if (actor.roles.includes(RoleCode.Admin)) {
      if (query.status) where.status = query.status;
    } else if (this.isFarmer(actor)) {
      and.push(await this.farmerVisibilityWhere(actor));
    } else {
      if (query.status) where.status = query.status;
      // Facilitators: published courses for the platform or their area, plus the
      // courses they generated for their own groups (any status).
      and.push({
        OR: [
          {
            status: CourseStatus.PUBLISHED,
            facilitatorOwnerId: null,
            publications: { some: await this.visiblePublicationWhere(actor.id) },
          },
          { facilitatorOwnerId: actor.id },
        ],
      });
    }
    if (and.length > 0) where.AND = and;

    const [courses, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        select: courseSelect,
        orderBy: { createdAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.course.count({ where }),
    ]);
    return paginated(courses.map((course) => toCourseResponse(course, actor)), total, query);
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<CourseResponseDto> {
    const course = await this.prisma.course.findUnique({ where: { id }, select: courseSelect });
    if (!course || !(await this.canView(course, actor))) throw new NotFoundException('Course not found');
    return toCourseResponse(course, actor);
  }

  async update(id: string, dto: UpdateCourseDto, actor: AuthenticatedUser): Promise<CourseResponseDto> {
    if (dto.cropId) await assertActiveCrop(this.prisma, dto.cropId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.course.findUnique({ where: { id }, select: { status: true } });
      if (!existing) throw new NotFoundException('Course not found');
      if (existing.status === CourseStatus.ARCHIVED && dto.status !== CourseStatus.DRAFT) {
        throw new ConflictException('Archived courses cannot be changed');
      }
      if (dto.status) {
        assertCourseStatusChange(existing.status, dto.status);
        if (dto.status === CourseStatus.ARCHIVED && existing.status === CourseStatus.PUBLISHED) {
          await closeCurrentPublication(tx, id, actor.id);
        }
      }
      return toCourseResponse(await tx.course.update({ where: { id }, data: dto, select: courseSelect }), actor);
    });
  }

  async remove(id: string): Promise<void> {
    const course = await this.prisma.course.findUnique({ where: { id }, select: { status: true } });
    if (!course) throw new NotFoundException('Course not found');
    assertCanDeleteCourse(course.status);
    const [publications, assignments] = await this.prisma.$transaction([
      this.prisma.coursePublication.count({ where: { courseId: id } }),
      this.prisma.facilitatorGroupCourse.count({ where: { courseId: id } }),
    ]);
    if (publications > 0 || assignments > 0) {
      throw new ConflictException('Courses that were published are kept. Archive the course instead');
    }
    await this.prisma.course.delete({ where: { id } });
  }

  /** Used by module and lesson reads. */
  async assertReadable(id: string, actor: AuthenticatedUser): Promise<void> {
    await this.findOne(id, actor);
  }

  /** Used by module and lesson writes. */
  async assertMutable(id: string): Promise<void> {
    const course = await this.prisma.course.findUnique({ where: { id }, select: { status: true } });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status === CourseStatus.ARCHIVED) {
      throw new ConflictException('Archived courses cannot be changed');
    }
  }

  private isFarmer(actor: AuthenticatedUser): boolean {
    return audiencesForRoles(actor.roles) !== null && !actor.roles.includes(RoleCode.Facilitator);
  }

  private async canView(course: CourseRecord, actor: AuthenticatedUser): Promise<boolean> {
    if (isAdmin(actor)) return true;
    if (this.isFarmer(actor)) return this.farmerCanView(course, actor);
    if (course.facilitatorOwner) return course.facilitatorOwner.id === actor.id;
    if (course.status !== CourseStatus.PUBLISHED) return false;
    const publication = await this.prisma.coursePublication.findFirst({
      where: { courseId: course.id, isCurrent: true },
      select: {
        scope: true,
        targets: { select: { group: { select: { cropId: true, province: true, district: true, sector: true } } } },
      },
    });
    if (!publication) return false;
    if (publication.scope === PublicationScope.PLATFORM) return true;
    const groups = await this.ownGroups(actor.id);
    return publication.targets.some((target) => groups.some((group) => groupMatchesTargeting(group, target.group)));
  }

  private async visiblePublicationWhere(facilitatorId: string): Promise<Prisma.CoursePublicationWhereInput> {
    const groups = await this.ownGroups(facilitatorId);
    return {
      isCurrent: true,
      OR: [
        { scope: PublicationScope.PLATFORM },
        ...(groups.length === 0
          ? []
          : [
              {
                scope: PublicationScope.TARGETED,
                targets: { some: { group: { OR: groups.map((group) => targetingMatchWhere(group)) } } },
              },
            ]),
      ],
    };
  }

  /**
   * A farmer sees a published course when the audience matches and the course is
   * platform-wide, targeted at their location and group crop, or assigned to a
   * facilitator group they belong to while that publication is still current.
   */
  private async farmerCanView(course: CourseRecord, actor: AuthenticatedUser): Promise<boolean> {
    if (course.status !== CourseStatus.PUBLISHED) return false;
    if (!audienceAllows(course.targetAudience, actor.roles)) return false;
    if (course.facilitatorOwner) {
      // Facilitator courses reach only the members of the groups they are published to.
      const member = await this.prisma.facilitatorGroupMember.findFirst({
        where: {
          userId: actor.id,
          group: { status: RecordStatus.ACTIVE, courses: { some: { courseId: course.id } } },
        },
        select: { userId: true },
      });
      return member !== null;
    }
    const publication = await this.prisma.coursePublication.findFirst({
      where: { courseId: course.id, isCurrent: true },
      select: {
        scope: true,
        targets: { select: { group: { select: { cropId: true, province: true, district: true, sector: true } } } },
      },
    });
    if (!publication) return false;
    if (publication.scope === PublicationScope.PLATFORM) return true;
    const farmer = await this.farmerArea(actor.id);
    if (
      farmer &&
      publication.targets.some((target) => farmerMatchesTarget(farmer, target.group))
    ) {
      return true;
    }
    const assigned = await this.prisma.facilitatorGroupCourse.findFirst({
      where: {
        courseId: course.id,
        group: { status: RecordStatus.ACTIVE, members: { some: { userId: actor.id } } },
      },
      select: { courseId: true },
    });
    return assigned !== null;
  }

  private async farmerVisibilityWhere(actor: AuthenticatedUser): Promise<Prisma.CourseWhereInput> {
    const audiences = audiencesForRoles(actor.roles) ?? [];
    const farmer = await this.farmerArea(actor.id);
    const or: Prisma.CourseWhereInput[] = [
      { publications: { some: { isCurrent: true, scope: PublicationScope.PLATFORM } } },
      // Courses a facilitator generated and published to a group the farmer belongs to.
      {
        facilitatorOwnerId: { not: null },
        groupCourses: {
          some: { group: { status: RecordStatus.ACTIVE, members: { some: { userId: actor.id } } } },
        },
      },
      {
        AND: [
          { publications: { some: { isCurrent: true } } },
          {
            groupCourses: {
              some: { group: { status: RecordStatus.ACTIVE, members: { some: { userId: actor.id } } } },
            },
          },
        ],
      },
    ];
    if (farmer) {
      or.push({
        publications: {
          some: {
            isCurrent: true,
            scope: PublicationScope.TARGETED,
            targets: {
              some: {
                group: {
                  OR: farmer.cropIds.map((cropId) =>
                    targetingMatchWhere({
                      cropId,
                      province: farmer.province,
                      district: farmer.district,
                      sector: farmer.sector,
                    }),
                  ),
                },
              },
            },
          },
        },
      });
    }
    return { status: CourseStatus.PUBLISHED, targetAudience: { in: audiences }, OR: or };
  }

  private async farmerArea(userId: string): Promise<FarmerArea | null> {
    const [location, memberships] = await Promise.all([
      this.prisma.userLocation.findUnique({
        where: { userId },
        select: { province: true, district: true, sector: true },
      }),
      this.prisma.facilitatorGroupMember.findMany({
        where: { userId, group: { status: RecordStatus.ACTIVE } },
        select: { group: { select: { cropId: true } } },
      }),
    ]);
    if (!location) return null;
    const cropIds = [...new Set(memberships.map((membership) => membership.group.cropId))];
    if (cropIds.length === 0) return null;
    return { province: location.province, district: location.district, sector: location.sector, cropIds };
  }

  /**
   * Publishes a facilitator's own course to one or more of their own active groups. Calling it
   * again replaces the set of groups. The course never gets a platform or targeted publication.
   */
  async publishToGroups(id: string, groupIds: string[], actor: AuthenticatedUser): Promise<CourseResponseDto> {
    const course = await this.ownedFacilitatorCourse(id, actor);
    if (course.status === CourseStatus.ARCHIVED) throw new ConflictException('Archived courses cannot be published');
    assertGenerationFinished(course.generation);
    const lessons = await this.prisma.lesson.count({ where: { module: { courseId: id } } });
    if (lessons === 0) throw new BadRequestException('Add at least one sub-chapter before publishing the course');
    const unique = [...new Set(groupIds)];
    const groups = await this.prisma.facilitatorGroup.count({
      where: { id: { in: unique }, facilitatorId: actor.id, status: RecordStatus.ACTIVE },
    });
    if (groups !== unique.length) {
      throw new BadRequestException('Choose only your own active groups');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.facilitatorGroupCourse.deleteMany({ where: { courseId: id, groupId: { notIn: unique } } });
      await tx.facilitatorGroupCourse.createMany({
        data: unique.map((groupId) => ({ groupId, courseId: id, assignedById: actor.id })),
        skipDuplicates: true,
      });
      if (course.status !== CourseStatus.PUBLISHED) {
        await tx.course.update({ where: { id }, data: { status: CourseStatus.PUBLISHED, publishedAt: new Date() } });
      }
    });
    return this.findOne(id, actor);
  }

  /** Withdraws a facilitator course from every group; it returns to draft. Progress is kept. */
  async unpublishFromGroups(id: string, actor: AuthenticatedUser): Promise<CourseResponseDto> {
    const course = await this.ownedFacilitatorCourse(id, actor);
    if (course.status !== CourseStatus.PUBLISHED) throw new ConflictException('The course is not published to any group');
    await this.prisma.$transaction([
      this.prisma.facilitatorGroupCourse.deleteMany({ where: { courseId: id } }),
      this.prisma.course.update({ where: { id }, data: { status: CourseStatus.DRAFT, publishedAt: null } }),
    ]);
    return this.findOne(id, actor);
  }

  private async ownedFacilitatorCourse(id: string, actor: AuthenticatedUser) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      select: { status: true, facilitatorOwnerId: true, generation: { select: { status: true } } },
    });
    if (!course || course.facilitatorOwnerId !== actor.id) throw new NotFoundException('Course not found');
    return course;
  }

  private async ownGroups(facilitatorId: string): Promise<AreaMatch[]> {
    return this.prisma.facilitatorGroup.findMany({
      where: { facilitatorId, status: RecordStatus.ACTIVE },
      select: { cropId: true, province: true, district: true, sector: true },
    });
  }
}
