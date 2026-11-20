import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import { CourseStatus, Prisma, PublicationScope, RecordStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertActiveCrop, cropSummarySelect } from '../crops/crop.lookup';
import { isAdmin } from '../groups/facilitator-groups.service';
import { RoleCode } from '../roles/rbac.constants';
import { assertCanDeleteCourse, assertCourseStatusChange } from './course-status.policy';
import type { CourseResponseDto, CreateCourseDto, ListCoursesQueryDto, UpdateCourseDto } from './dto/course.dto';
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
} satisfies Prisma.CourseSelect;

type CourseRecord = Prisma.CourseGetPayload<{ select: typeof courseSelect }>;

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCourseDto, actor: AuthenticatedUser): Promise<CourseResponseDto> {
    await assertActiveCrop(this.prisma, dto.cropId);
    const course = await this.prisma.course.create({
      data: { ...dto, createdById: actor.id },
      select: courseSelect,
    });
    return course;
  }

  async list(query: ListCoursesQueryDto, actor: AuthenticatedUser): Promise<Paginated<CourseResponseDto>> {
    const where: Prisma.CourseWhereInput = {};
    if (query.cropId) where.cropId = query.cropId;
    if (query.language) where.language = query.language;
    if (query.category) where.category = query.category;
    if (query.difficulty) where.difficulty = query.difficulty;
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
      where.status = CourseStatus.PUBLISHED;
      where.publications = { some: await this.visiblePublicationWhere(actor.id) };
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
    return paginated(courses, total, query);
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<CourseResponseDto> {
    const course = await this.prisma.course.findUnique({ where: { id }, select: courseSelect });
    if (!course || !(await this.canView(course, actor))) throw new NotFoundException('Course not found');
    return course;
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
      return tx.course.update({ where: { id }, data: dto, select: courseSelect });
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

  private async ownGroups(facilitatorId: string): Promise<AreaMatch[]> {
    return this.prisma.facilitatorGroup.findMany({
      where: { facilitatorId, status: RecordStatus.ACTIVE },
      select: { cropId: true, province: true, district: true, sector: true },
    });
  }
}
