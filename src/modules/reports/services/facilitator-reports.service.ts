import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { reportsConfig } from '../../../config/configuration';
import {
  AttemptStatus,
  EnrollmentStatus,
  LessonProgressStatus,
  Prisma,
  RecordStatus,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  countByUtcDay,
  parseDateRange,
  seriesFromCounts,
  timestampFilter,
} from '../common/date-range';
import { ReportScopeService } from '../common/report-scope.service';
import type { ReportFilterQueryDto } from '../dto/report-query.dto';

@Injectable()
export class FacilitatorReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ReportScopeService,
    @Inject(reportsConfig.KEY) private readonly config: ConfigType<typeof reportsConfig>,
  ) {}

  async dashboard(actor: AuthenticatedUser, query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const inRange = timestampFilter(range);
    const farmerIds = await this.scope.facilitatorFarmerIds(actor, query.groupId);
    const groups = await this.prisma.facilitatorGroup.findMany({
      where: {
        facilitatorId: actor.id,
        status: RecordStatus.ACTIVE,
        ...(query.groupId ? { id: query.groupId } : {}),
      },
      select: {
        id: true,
        name: true,
        _count: { select: { members: true, courses: true } },
      },
    });

    const [
      enrollments,
      completed,
      attempts,
      byType,
      byDistrict,
      completions,
      activeLearners,
      courses,
    ] = await Promise.all([
      this.prisma.courseEnrollment.groupBy({
        by: ['status'],
        where: { userId: { in: farmerIds } },
        _count: { _all: true },
      }),
      this.prisma.lessonProgress.count({
        where: {
          userId: { in: farmerIds },
          status: LessonProgressStatus.COMPLETED,
        },
      }),
      this.prisma.assessmentAttempt.groupBy({
        by: ['status'],
        where: { userId: { in: farmerIds } },
        _count: { _all: true },
      }),
      this.prisma.farmerProfile.groupBy({
        by: ['farmerType'],
        where: { userId: { in: farmerIds }, user: { deletedAt: null } },
        _count: { _all: true },
      }),
      this.prisma.userLocation.groupBy({
        by: ['district'],
        where: { userId: { in: farmerIds }, user: { deletedAt: null } },
        _count: { _all: true },
      }),
      // Completed lessons inside the selected range (all time when no range is given).
      this.prisma.lessonProgress.findMany({
        where: {
          userId: { in: farmerIds },
          status: LessonProgressStatus.COMPLETED,
          completedAt: inRange ?? { not: null },
        },
        select: { completedAt: true },
      }),
      // Farmers who opened a lesson inside the range.
      this.prisma.lessonProgress.findMany({
        where: {
          userId: { in: farmerIds },
          lastAccessedAt: inRange ?? { not: null },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.course.groupBy({
        by: ['status'],
        where: { createdById: actor.id },
        _count: { _all: true },
      }),
    ]);

    return {
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        members: group._count.members,
        assignedCourses: group._count.courses,
      })),
      farmersInScope: farmerIds.length,
      enrollmentsByStatus: enrollments.map((row) => ({
        key: row.status,
        count: row._count._all,
      })),
      completedLessonProgress: completed,
      assessmentAttemptsByStatus: attempts.map((row) => ({
        key: row.status,
        count: row._count._all,
      })),
      farmersByType: byType.map((row) => ({ key: row.farmerType, count: row._count._all })),
      farmersByDistrict: byDistrict.map((row) => ({ key: row.district, count: row._count._all })),
      completedLessonsInRange: completions.length,
      completionsOverTime: seriesFromCounts(
        countByUtcDay(completions.flatMap((row) => (row.completedAt ? [row.completedAt] : []))),
      ),
      activeLearnersInRange: activeLearners.length,
      coursesByStatus: courses.map((row) => ({ key: row.status, count: row._count._all })),
    };
  }

  async groups(actor: AuthenticatedUser, query: ReportFilterQueryDto) {
    parseDateRange(query.startDate, query.endDate);
    if (query.groupId) await this.scope.assertOwnsGroup(actor, query.groupId);
    const groups = await this.prisma.facilitatorGroup.findMany({
      where: {
        facilitatorId: actor.id,
        status: RecordStatus.ACTIVE,
        ...(query.groupId ? { id: query.groupId } : {}),
      },
      select: {
        id: true,
        name: true,
        province: true,
        district: true,
        _count: { select: { members: true, courses: true } },
        members: {
          select: {
            userId: true,
            user: {
              select: {
                fullName: true,
                status: true,
                farmerProfile: { select: { farmerType: true } },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return {
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        province: group.province,
        district: group.district,
        members: group._count.members,
        assignedCourses: group._count.courses,
        farmers: group.members.map((member) => ({
          userId: member.userId,
          fullName: member.user.fullName,
          status: member.user.status,
          farmerType: member.user.farmerProfile?.farmerType ?? null,
        })),
      })),
    };
  }

  async learning(actor: AuthenticatedUser, query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const farmerIds = await this.scope.facilitatorFarmerIds(actor, query.groupId);
    const where: Prisma.CourseEnrollmentWhereInput = {
      userId: { in: farmerIds },
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(timestampFilter(range) ? { enrolledAt: timestampFilter(range) } : {}),
    };
    const [byStatus, byCourse, sessions] = await Promise.all([
      this.prisma.courseEnrollment.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.courseEnrollment.groupBy({
        by: ['courseId', 'status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.learningSession.groupBy({
        by: ['channel'],
        where: {
          userId: { in: farmerIds },
          ...(timestampFilter(range) ? { startedAt: timestampFilter(range) } : {}),
        },
        _count: { _all: true },
      }),
    ]);

    const courseMap = new Map<string, { courseId: string; active: number; completed: number }>();
    for (const row of byCourse) {
      const current = courseMap.get(row.courseId) ?? {
        courseId: row.courseId,
        active: 0,
        completed: 0,
      };
      if (row.status === EnrollmentStatus.ACTIVE) current.active = row._count._all;
      if (row.status === EnrollmentStatus.COMPLETED) current.completed = row._count._all;
      courseMap.set(row.courseId, current);
    }

    return {
      farmersInScope: farmerIds.length,
      enrollmentsByStatus: byStatus.map((row) => ({ key: row.status, count: row._count._all })),
      byCourse: [...courseMap.values()].map((row) => {
        const terminal = row.active + row.completed;
        return {
          ...row,
          completionRate: terminal === 0 ? null : Number((row.completed / terminal).toFixed(4)),
        };
      }),
      sessionsByChannel: sessions.map((row) => ({ key: row.channel, count: row._count._all })),
      activeLearnerDays: this.config.activeLearnerDays,
    };
  }

  async assessments(actor: AuthenticatedUser, query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const farmerIds = await this.scope.facilitatorFarmerIds(actor, query.groupId);
    const where: Prisma.AssessmentAttemptWhereInput = {
      userId: { in: farmerIds },
      ...(timestampFilter(range) ? { startedAt: timestampFilter(range) } : {}),
    };
    const [byStatus, scored] = await Promise.all([
      this.prisma.assessmentAttempt.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.assessmentAttempt.aggregate({
        where: {
          ...where,
          percentage: { not: null },
          status: { in: [AttemptStatus.PASSED, AttemptStatus.FAILED] },
        },
        _avg: { percentage: true },
        _count: { _all: true },
      }),
    ]);
    const passed = byStatus.find((row) => row.status === AttemptStatus.PASSED)?._count._all ?? 0;
    const failed = byStatus.find((row) => row.status === AttemptStatus.FAILED)?._count._all ?? 0;
    const decided = passed + failed;
    return {
      farmersInScope: farmerIds.length,
      attemptsByStatus: byStatus.map((row) => ({ key: row.status, count: row._count._all })),
      averagePercentage:
        scored._avg.percentage === null ? null : Number(scored._avg.percentage.toFixed(2)),
      passRate: decided === 0 ? null : Number((passed / decided).toFixed(4)),
    };
  }
}
