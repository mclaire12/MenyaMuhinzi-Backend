import { Injectable } from '@nestjs/common';
import {
  AttemptStatus,
  EnrollmentStatus,
  LessonProgressStatus,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { parseDateRange, timestampFilter } from '../common/date-range';
import type { ReportFilterQueryDto } from '../dto/report-query.dto';

@Injectable()
export class FarmerReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(actor: AuthenticatedUser, query: ReportFilterQueryDto) {
    parseDateRange(query.startDate, query.endDate);
    const userId = actor.id;
    const [enrollments, progress, attempts, unread] = await Promise.all([
      this.prisma.courseEnrollment.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.lessonProgress.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.assessmentAttempt.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.notification.count({
        where: { userId, readAt: null, archivedAt: null },
      }),
    ]);
    return {
      enrollmentsByStatus: enrollments.map((row) => ({ key: row.status, count: row._count._all })),
      lessonProgressByStatus: progress.map((row) => ({ key: row.status, count: row._count._all })),
      assessmentAttemptsByStatus: attempts.map((row) => ({
        key: row.status,
        count: row._count._all,
      })),
      unreadNotifications: unread,
    };
  }

  async progress(actor: AuthenticatedUser, query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const userId = actor.id;
    const enrollments = await this.prisma.courseEnrollment.findMany({
      where: {
        userId,
        ...(query.courseId ? { courseId: query.courseId } : {}),
        ...(timestampFilter(range) ? { enrolledAt: timestampFilter(range) } : {}),
      },
      select: {
        id: true,
        courseId: true,
        status: true,
        enrolledAt: true,
        completedAt: true,
        course: { select: { title: true } },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    const courseIds = enrollments.map((row) => row.courseId);
    const [lessonProgress, sessions, attempts] = await Promise.all([
      this.prisma.lessonProgress.groupBy({
        by: ['courseId', 'status'],
        where: { userId, courseId: { in: courseIds } },
        _count: { _all: true },
      }),
      this.prisma.learningSession.groupBy({
        by: ['channel'],
        where: {
          userId,
          ...(timestampFilter(range) ? { startedAt: timestampFilter(range) } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.assessmentAttempt.findMany({
        where: {
          userId,
          ...(timestampFilter(range) ? { startedAt: timestampFilter(range) } : {}),
        },
        select: {
          id: true,
          assessmentId: true,
          status: true,
          percentage: true,
          passed: true,
          startedAt: true,
          submittedAt: true,
        },
        orderBy: { startedAt: 'desc' },
        take: 100,
      }),
    ]);

    return {
      enrollments: enrollments.map((row) => ({
        enrollmentId: row.id,
        courseId: row.courseId,
        courseTitle: row.course.title,
        status: row.status,
        enrolledAt: row.enrolledAt,
        completedAt: row.completedAt,
        lessonProgress: {
          completed:
            lessonProgress.find(
              (p) => p.courseId === row.courseId && p.status === LessonProgressStatus.COMPLETED,
            )?._count._all ?? 0,
          inProgress:
            lessonProgress.find(
              (p) => p.courseId === row.courseId && p.status === LessonProgressStatus.IN_PROGRESS,
            )?._count._all ?? 0,
        },
        isCompleted: row.status === EnrollmentStatus.COMPLETED,
      })),
      sessionsByChannel: sessions.map((row) => ({ key: row.channel, count: row._count._all })),
      recentAttempts: attempts.map((row) => ({
        id: row.id,
        assessmentId: row.assessmentId,
        status: row.status,
        percentage: row.percentage,
        passed: row.passed,
        startedAt: row.startedAt,
        submittedAt: row.submittedAt,
        isPassed: row.status === AttemptStatus.PASSED,
      })),
    };
  }
}
