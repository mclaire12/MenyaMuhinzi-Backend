import { ConflictException, Injectable } from '@nestjs/common';
import {
  CourseStatus,
  Prisma,
  PublicationScope,
  RecordStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { groupMatchesTargeting } from '../courses/publication-eligibility';
import type { GroupCourseResponseDto } from './dto/facilitator-group.dto';
import { FacilitatorGroupsService } from './facilitator-groups.service';

const assignmentSelect = {
  assignedAt: true,
  course: {
    select: {
      id: true,
      title: true,
      status: true,
      language: true,
      crop: { select: { id: true, code: true, nameEn: true, nameRw: true } },
    },
  },
  assignedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.FacilitatorGroupCourseSelect;

@Injectable()
export class GroupCoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: FacilitatorGroupsService,
  ) {}

  async assign(
    groupId: string,
    courseId: string,
    actor: AuthenticatedUser,
  ): Promise<GroupCourseResponseDto> {
    const group = await this.groups.accessible(groupId, actor);
    if (group.status !== RecordStatus.ACTIVE) {
      throw new ConflictException('Inactive groups cannot receive courses');
    }

    const publication = await this.prisma.coursePublication.findFirst({
      where: { courseId, isCurrent: true, course: { status: CourseStatus.PUBLISHED } },
      select: {
        scope: true,
        targets: {
          select: {
            group: { select: { cropId: true, province: true, district: true, sector: true } },
          },
        },
      },
    });
    if (!publication) {
      throw new ConflictException('Only a published course can be assigned to a farmer group');
    }
    if (publication.scope === PublicationScope.TARGETED) {
      const eligible = publication.targets.some((target) =>
        groupMatchesTargeting(
          {
            cropId: group.crop.id,
            province: group.province,
            district: group.district,
            sector: group.sector,
          },
          target.group,
        ),
      );
      if (!eligible) {
        throw new ConflictException(
          "This course is not published for this group's crop and location",
        );
      }
    }

    try {
      const assignment = await this.prisma.facilitatorGroupCourse.create({
        data: { groupId, courseId, assignedById: actor.id },
        select: assignmentSelect,
      });
      return toAssignment(assignment);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This course is already assigned to the group');
      }
      throw error;
    }
  }

  async list(groupId: string, actor: AuthenticatedUser): Promise<GroupCourseResponseDto[]> {
    await this.groups.accessible(groupId, actor);
    const assignments = await this.prisma.facilitatorGroupCourse.findMany({
      where: { groupId },
      select: assignmentSelect,
      orderBy: { assignedAt: 'asc' },
    });
    return assignments.map(toAssignment);
  }
}

function toAssignment(
  assignment: Prisma.FacilitatorGroupCourseGetPayload<{ select: typeof assignmentSelect }>,
): GroupCourseResponseDto {
  return assignment;
}
