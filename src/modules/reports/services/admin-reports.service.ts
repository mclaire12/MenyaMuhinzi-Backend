import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { reportsConfig } from '../../../config/configuration';
import {
  AccountRequestStatus,
  AiRequestStatus,
  AttemptStatus,
  CourseStatus,
  EnrollmentStatus,
  FarmerType,
  KnowledgeChunkStatus,
  KnowledgeJobStatus,
  KnowledgeSourceStatus,
  LessonProgressStatus,
  NotificationChannel,
  NotificationDeliveryStatus,
  Prisma,
  RecordStatus,
  UserStatus,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { RoleCode } from '../../roles/rbac.constants';
import {
  countByUtcDay,
  parseDateRange,
  seriesFromCounts,
  timestampFilter,
} from '../common/date-range';
import type { ReportFilterQueryDto } from '../dto/report-query.dto';

@Injectable()
export class AdminReportsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(reportsConfig.KEY) private readonly config: ConfigType<typeof reportsConfig>,
  ) {}

  async dashboard(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const created = timestampFilter(range);

    const [
      usersByStatus,
      smartphoneFarmers,
      basicPhoneFarmers,
      facilitators,
      farmerGroups,
      groupMembers,
      coursesByStatus,
      lessons,
      enrollmentsByStatus,
      completedLessons,
      attemptsByStatus,
      knowledgeByStatus,
      knowledgeJobsByStatus,
      embeddedChunks,
      aiByStatus,
      aiUsageByStatus,
      deliveriesByStatus,
      deliveriesByChannel,
      unreadNotifications,
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['status'],
        where: { deletedAt: null, ...(created ? { createdAt: created } : {}) },
        _count: { _all: true },
      }),
      this.prisma.farmerProfile.count({
        where: {
          farmerType: FarmerType.SMARTPHONE,
          user: { deletedAt: null },
        },
      }),
      this.prisma.farmerProfile.count({
        where: {
          farmerType: FarmerType.BASIC_PHONE,
          user: { deletedAt: null },
        },
      }),
      this.prisma.userRole.count({
        where: { role: { code: RoleCode.Facilitator }, user: { deletedAt: null } },
      }),
      this.prisma.facilitatorGroup.count({ where: { status: RecordStatus.ACTIVE } }),
      this.prisma.facilitatorGroupMember.count({
        where: { group: { status: RecordStatus.ACTIVE } },
      }),
      this.prisma.course.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.lesson.count(),
      this.prisma.courseEnrollment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.lessonProgress.count({ where: { status: LessonProgressStatus.COMPLETED } }),
      this.prisma.assessmentAttempt.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.knowledgeSource.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.knowledgeProcessingJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.knowledgeChunk.count({ where: { status: KnowledgeChunkStatus.EMBEDDED } }),
      this.prisma.aiRequest.groupBy({
        by: ['status'],
        where: created ? { createdAt: created } : {},
        _count: { _all: true },
      }),
      this.prisma.aiUsageRecord.groupBy({
        by: ['status'],
        where: created ? { recordedAt: created } : {},
        _count: { _all: true },
      }),
      this.prisma.notificationDelivery.groupBy({
        by: ['status'],
        where: created ? { createdAt: created } : {},
        _count: { _all: true },
      }),
      this.prisma.notificationDelivery.groupBy({
        by: ['channel'],
        where: created ? { createdAt: created } : {},
        _count: { _all: true },
      }),
      this.prisma.notification.count({
        where: { readAt: null, archivedAt: null },
      }),
    ]);

    const userTotal = usersByStatus.reduce((sum, row) => sum + row._count._all, 0);
    return {
      generatedAt: new Date().toISOString(),
      dateRange: {
        startDate: range.start?.toISOString() ?? null,
        endDate: range.end?.toISOString() ?? null,
        startInclusive: true,
        endExclusive: true,
      },
      users: {
        total: userTotal,
        byStatus: usersByStatus.map((row) => ({ key: row.status, count: row._count._all })),
        smartphoneFarmers,
        basicPhoneFarmers,
        facilitators,
      },
      groups: { activeFacilitatorGroups: farmerGroups, memberships: groupMembers },
      learning: {
        coursesByStatus: coursesByStatus.map((row) => ({
          key: row.status,
          count: row._count._all,
        })),
        lessons,
        enrollmentsByStatus: enrollmentsByStatus.map((row) => ({
          key: row.status,
          count: row._count._all,
        })),
        completedLessonProgress: completedLessons,
        assessmentAttemptsByStatus: attemptsByStatus.map((row) => ({
          key: row.status,
          count: row._count._all,
        })),
      },
      knowledge: {
        sourcesByStatus: knowledgeByStatus.map((row) => ({
          key: row.status,
          count: row._count._all,
        })),
        processingJobsByStatus: knowledgeJobsByStatus.map((row) => ({
          key: row.status,
          count: row._count._all,
        })),
        embeddedChunks,
      },
      ai: {
        requestsByStatus: aiByStatus.map((row) => ({ key: row.status, count: row._count._all })),
        usageByStatus: aiUsageByStatus.map((row) => ({
          key: row.status,
          count: row._count._all,
        })),
        note: 'Token and cost totals are omitted here; use /admin/reports/ai or /admin/ai/usage/summary. Null provider figures stay null.',
      },
      notifications: {
        deliveriesByStatus: deliveriesByStatus.map((row) => ({
          key: row.status,
          count: row._count._all,
        })),
        deliveriesByChannel: deliveriesByChannel.map((row) => ({
          key: row.channel,
          count: row._count._all,
        })),
        unreadInApp: unreadNotifications,
        note: 'External channels are never reported as DELIVERED without a provider receipt. Only IN_APP is delivered by the platform today.',
      },
    };
  }

  async users(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const created = timestampFilter(range);
    const [byStatus, byRole, locked] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['status'],
        where: { deletedAt: null, ...(created ? { createdAt: created } : {}) },
        _count: { _all: true },
      }),
      this.prisma.userRole.groupBy({
        by: ['roleId'],
        where: {
          user: { deletedAt: null, ...(created ? { createdAt: created } : {}) },
        },
        _count: { _all: true },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, lockedUntil: { gt: new Date() } },
      }),
    ]);
    const roles = await this.prisma.role.findMany({
      where: { id: { in: byRole.map((row) => row.roleId) } },
      select: { id: true, code: true },
    });
    const roleCode = new Map(roles.map((role) => [role.id, role.code]));
    return {
      byStatus: byStatus.map((row) => ({ key: row.status, count: row._count._all })),
      byRole: byRole.map((row) => ({
        key: roleCode.get(row.roleId) ?? row.roleId,
        count: row._count._all,
      })),
      currentlyLocked: locked,
      statuses: Object.values(UserStatus),
    };
  }

  async registrations(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const created = timestampFilter(range);
    const farmerWhere: Prisma.FarmerProfileWhereInput = {
      ...(query.farmerType ? { farmerType: query.farmerType } : {}),
      ...(query.farmerCategory ? { farmerCategory: query.farmerCategory } : {}),
      user: {
        deletedAt: null,
        ...(created ? { createdAt: created } : {}),
        ...(query.province || query.district
          ? {
              location: {
                ...(query.province ? { province: query.province } : {}),
                ...(query.district ? { district: query.district } : {}),
              },
            }
          : {}),
      },
    };

    const [byType, byCategory, byProvince, createdAts, pendingRequests, decisions] =
      await Promise.all([
        this.prisma.farmerProfile.groupBy({
          by: ['farmerType'],
          where: farmerWhere,
          _count: { _all: true },
        }),
        this.prisma.farmerProfile.groupBy({
          by: ['farmerCategory'],
          where: farmerWhere,
          _count: { _all: true },
        }),
        this.prisma.userLocation.groupBy({
          by: ['province'],
          where: {
            ...(query.province ? { province: query.province } : {}),
            ...(query.district ? { district: query.district } : {}),
            user: {
              deletedAt: null,
              farmerProfile: {
                is: {
                  ...(query.farmerType ? { farmerType: query.farmerType } : {}),
                  ...(query.farmerCategory ? { farmerCategory: query.farmerCategory } : {}),
                },
              },
              ...(created ? { createdAt: created } : {}),
            },
          },
          _count: { _all: true },
        }),
        this.prisma.user.findMany({
          where: {
            deletedAt: null,
            farmerProfile: {
              is: {
                ...(query.farmerType ? { farmerType: query.farmerType } : {}),
                ...(query.farmerCategory ? { farmerCategory: query.farmerCategory } : {}),
              },
            },
            ...(created ? { createdAt: created } : {}),
            ...(query.province || query.district
              ? {
                  location: {
                    ...(query.province ? { province: query.province } : {}),
                    ...(query.district ? { district: query.district } : {}),
                  },
                }
              : {}),
          },
          select: { createdAt: true },
        }),
        this.prisma.accountRequest.count({
          where: {
            status: AccountRequestStatus.PENDING,
            ...(created ? { createdAt: created } : {}),
          },
        }),
        this.prisma.accountApproval.groupBy({
          by: ['decision'],
          where: created ? { decidedAt: created } : {},
          _count: { _all: true },
        }),
      ]);

    return {
      byFarmerType: byType.map((row) => ({ key: row.farmerType, count: row._count._all })),
      byFarmerCategory: byCategory.map((row) => ({
        key: row.farmerCategory,
        count: row._count._all,
      })),
      byProvince: byProvince.map((row) => ({ key: row.province, count: row._count._all })),
      registrationsOverTime: seriesFromCounts(
        countByUtcDay(createdAts.map((row) => row.createdAt)),
      ),
      pendingAccountRequests: pendingRequests,
      approvalDecisions: decisions.map((row) => ({
        key: row.decision,
        count: row._count._all,
      })),
    };
  }

  async learning(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const enrolled = timestampFilter(range);
    const activeSince = new Date(
      (range.end?.getTime() ?? Date.now()) - this.config.activeLearnerDays * 86_400_000,
    );

    const enrollmentWhere: Prisma.CourseEnrollmentWhereInput = {
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(enrolled ? { enrolledAt: enrolled } : {}),
      ...(query.province || query.district || query.farmerType || query.farmerCategory
        ? {
            user: {
              deletedAt: null,
              ...(query.province || query.district
                ? {
                    location: {
                      ...(query.province ? { province: query.province } : {}),
                      ...(query.district ? { district: query.district } : {}),
                    },
                  }
                : {}),
              ...(query.farmerType || query.farmerCategory
                ? {
                    farmerProfile: {
                      ...(query.farmerType ? { farmerType: query.farmerType } : {}),
                      ...(query.farmerCategory ? { farmerCategory: query.farmerCategory } : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(query.groupId
        ? {
            user: {
              facilitatorGroupMemberships: { some: { groupId: query.groupId } },
            },
          }
        : {}),
    };

    const [
      enrollmentsByStatus,
      enrollmentsByCourse,
      completedLessons,
      inProgressLessons,
      sessionsByChannel,
      enrolledUserIds,
      activeFromSessions,
      activeFromProgress,
    ] = await Promise.all([
      this.prisma.courseEnrollment.groupBy({
        by: ['status'],
        where: enrollmentWhere,
        _count: { _all: true },
      }),
      this.prisma.courseEnrollment.groupBy({
        by: ['courseId', 'status'],
        where: enrollmentWhere,
        _count: { _all: true },
      }),
      this.prisma.lessonProgress.count({
        where: {
          status: LessonProgressStatus.COMPLETED,
          ...(query.courseId ? { courseId: query.courseId } : {}),
          ...(timestampFilter(range) ? { completedAt: timestampFilter(range) } : {}),
        },
      }),
      this.prisma.lessonProgress.count({
        where: {
          status: LessonProgressStatus.IN_PROGRESS,
          ...(query.courseId ? { courseId: query.courseId } : {}),
        },
      }),
      this.prisma.learningSession.groupBy({
        by: ['channel'],
        where: {
          ...(query.channel ? { channel: query.channel } : {}),
          ...(query.courseId ? { courseId: query.courseId } : {}),
          ...(timestampFilter(range) ? { startedAt: timestampFilter(range) } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.courseEnrollment.findMany({
        where: { ...enrollmentWhere, status: EnrollmentStatus.ACTIVE },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.learningSession.findMany({
        where: {
          startedAt: {
            gte: activeSince,
            ...(range.end ? { lt: range.end } : {}),
          },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.lessonProgress.findMany({
        where: {
          OR: [
            {
              lastAccessedAt: {
                gte: activeSince,
                ...(range.end ? { lt: range.end } : {}),
              },
            },
            {
              updatedAt: {
                gte: activeSince,
                ...(range.end ? { lt: range.end } : {}),
              },
            },
          ],
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    const enrolledIds = new Set(enrolledUserIds.map((row) => row.userId));
    const activeIds = new Set([
      ...activeFromSessions.map((row) => row.userId),
      ...activeFromProgress.map((row) => row.userId),
    ]);
    let activeLearners = 0;
    for (const id of enrolledIds) if (activeIds.has(id)) activeLearners += 1;

    const byCourse = new Map<
      string,
      { courseId: string; active: number; completed: number; withdrawn: number; suspended: number }
    >();
    for (const row of enrollmentsByCourse) {
      const current = byCourse.get(row.courseId) ?? {
        courseId: row.courseId,
        active: 0,
        completed: 0,
        withdrawn: 0,
        suspended: 0,
      };
      if (row.status === EnrollmentStatus.ACTIVE) current.active = row._count._all;
      if (row.status === EnrollmentStatus.COMPLETED) current.completed = row._count._all;
      if (row.status === EnrollmentStatus.WITHDRAWN) current.withdrawn = row._count._all;
      if (row.status === EnrollmentStatus.SUSPENDED) current.suspended = row._count._all;
      byCourse.set(row.courseId, current);
    }

    return {
      enrollmentsByStatus: enrollmentsByStatus.map((row) => ({
        key: row.status,
        count: row._count._all,
      })),
      byCourse: [...byCourse.values()].map((row) => {
        const terminal = row.active + row.completed;
        return {
          ...row,
          completionRate: terminal === 0 ? null : Number((row.completed / terminal).toFixed(4)),
        };
      }),
      lessonProgress: { completed: completedLessons, inProgress: inProgressLessons },
      sessionsByChannel: sessionsByChannel.map((row) => ({
        key: row.channel,
        count: row._count._all,
      })),
      learners: {
        enrolledActive: enrolledIds.size,
        activeInWindow: activeLearners,
        inactiveInWindow: enrolledIds.size - activeLearners,
        activeLearnerDays: this.config.activeLearnerDays,
        definition: `Active = has a learning session startedAt or lesson progress lastAccessedAt/updatedAt within the last ${this.config.activeLearnerDays} days ending at endDate (or now). Only ACTIVE enrollments are counted.`,
      },
    };
  }

  async courses(query: ReportFilterQueryDto) {
    parseDateRange(query.startDate, query.endDate);
    const courses = await this.prisma.course.findMany({
      where: query.courseId ? { id: query.courseId } : {},
      select: {
        id: true,
        title: true,
        status: true,
        language: true,
        _count: { select: { enrollments: true, modules: true } },
      },
      orderBy: { title: 'asc' },
      take: 500,
    });
    const published = courses.filter((course) => course.status === CourseStatus.PUBLISHED).length;
    const draft = courses.filter((course) => course.status === CourseStatus.DRAFT).length;
    return {
      totals: { courses: courses.length, published, draft },
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        status: course.status,
        language: course.language,
        modules: course._count.modules,
        enrollments: course._count.enrollments,
      })),
    };
  }

  async assessments(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const started = timestampFilter(range);
    const where: Prisma.AssessmentAttemptWhereInput = {
      ...(started ? { startedAt: started } : {}),
      ...(query.courseId
        ? {
            assessment: {
              OR: [
                { courseId: query.courseId },
                { module: { courseId: query.courseId } },
                { lesson: { module: { courseId: query.courseId } } },
              ],
            },
          }
        : {}),
      ...(query.groupId
        ? { user: { facilitatorGroupMemberships: { some: { groupId: query.groupId } } } }
        : {}),
    };

    const [byStatus, scored, byAssessment] = await Promise.all([
      this.prisma.assessmentAttempt.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.assessmentAttempt.aggregate({
        where: {
          ...where,
          percentage: { not: null },
          status: { in: [AttemptStatus.PASSED, AttemptStatus.FAILED, AttemptStatus.SUBMITTED] },
        },
        _avg: { percentage: true },
        _count: { _all: true },
      }),
      this.prisma.assessmentAttempt.groupBy({
        by: ['assessmentId', 'status'],
        where,
        _count: { _all: true },
        _avg: { percentage: true },
      }),
    ]);

    const passed = byStatus.find((row) => row.status === AttemptStatus.PASSED)?._count._all ?? 0;
    const failed = byStatus.find((row) => row.status === AttemptStatus.FAILED)?._count._all ?? 0;
    const abandoned =
      byStatus.find((row) => row.status === AttemptStatus.IN_PROGRESS)?._count._all ?? 0;
    const decided = passed + failed;

    const perAssessment = new Map<
      string,
      {
        assessmentId: string;
        attempts: number;
        passed: number;
        failed: number;
        averagePercentage: number | null;
      }
    >();
    for (const row of byAssessment) {
      const current = perAssessment.get(row.assessmentId) ?? {
        assessmentId: row.assessmentId,
        attempts: 0,
        passed: 0,
        failed: 0,
        averagePercentage: null,
      };
      current.attempts += row._count._all;
      if (row.status === AttemptStatus.PASSED) current.passed = row._count._all;
      if (row.status === AttemptStatus.FAILED) current.failed = row._count._all;
      if (row._avg.percentage !== null)
        current.averagePercentage = Number(row._avg.percentage.toFixed(2));
      perAssessment.set(row.assessmentId, current);
    }

    return {
      attemptsByStatus: byStatus.map((row) => ({ key: row.status, count: row._count._all })),
      averagePercentage:
        scored._avg.percentage === null ? null : Number(scored._avg.percentage.toFixed(2)),
      scoredAttempts: scored._count._all,
      passRate: decided === 0 ? null : Number((passed / decided).toFixed(4)),
      failureRate: decided === 0 ? null : Number((failed / decided).toFixed(4)),
      abandonedInProgress: abandoned,
      byAssessment: [...perAssessment.values()],
      note: 'Abandoned means attempts still IN_PROGRESS. Average percentage only uses attempts that recorded a percentage.',
    };
  }

  async facilitators(query: ReportFilterQueryDto) {
    parseDateRange(query.startDate, query.endDate);
    const facilitators = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        roles: { some: { role: { code: RoleCode.Facilitator } } },
        ...(query.facilitatorId ? { id: query.facilitatorId } : {}),
      },
      select: {
        id: true,
        fullName: true,
        status: true,
        facilitatorProfile: { select: { organization: true } },
        facilitatorGroupsLed: {
          where: { status: RecordStatus.ACTIVE },
          select: {
            id: true,
            _count: { select: { members: true, courses: true } },
          },
        },
      },
      orderBy: { fullName: 'asc' },
      take: 500,
    });
    return {
      facilitators: facilitators.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        status: user.status,
        organization: user.facilitatorProfile?.organization ?? null,
        activeGroups: user.facilitatorGroupsLed.length,
        members: user.facilitatorGroupsLed.reduce(
          (sum, group) => sum + group._count.members,
          0,
        ),
        assignedCourses: user.facilitatorGroupsLed.reduce(
          (sum, group) => sum + group._count.courses,
          0,
        ),
      })),
    };
  }

  async groups(query: ReportFilterQueryDto) {
    parseDateRange(query.startDate, query.endDate);
    const groups = await this.prisma.facilitatorGroup.findMany({
      where: {
        ...(query.groupId ? { id: query.groupId } : {}),
        ...(query.facilitatorId ? { facilitatorId: query.facilitatorId } : {}),
        ...(query.province ? { province: query.province } : {}),
        ...(query.district ? { district: query.district } : {}),
        status: RecordStatus.ACTIVE,
      },
      select: {
        id: true,
        name: true,
        province: true,
        district: true,
        facilitatorId: true,
        _count: { select: { members: true, courses: true } },
      },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return {
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        province: group.province,
        district: group.district,
        facilitatorId: group.facilitatorId,
        members: group._count.members,
        assignedCourses: group._count.courses,
      })),
    };
  }

  async ai(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const created = timestampFilter(range);
    const where: Prisma.AiRequestWhereInput = created ? { createdAt: created } : {};

    const [byStatus, byAssistant, duration, usage, validations, byLanguage] = await Promise.all([
      this.prisma.aiRequest.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.aiRequest.groupBy({ by: ['assistantId'], where, _count: { _all: true } }),
      this.prisma.aiRequest.aggregate({
        where: { ...where, durationMs: { not: null } },
        _avg: { durationMs: true },
        _count: { _all: true },
      }),
      this.prisma.aiUsageRecord.aggregate({
        where: created ? { recordedAt: created } : {},
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      this.prisma.aiResponseValidation.groupBy({
        by: ['status'],
        where: created ? { validatedAt: created } : {},
        _count: { _all: true },
      }),
      this.prisma.aiConversation.groupBy({
        by: ['language'],
        where: created ? { createdAt: created } : {},
        _count: { _all: true },
      }),
    ]);

    const usageStatus = await this.prisma.aiUsageRecord.groupBy({
      by: ['status'],
      where: created ? { recordedAt: created } : {},
      _count: { _all: true },
    });

    return {
      requestsByStatus: byStatus.map((row) => ({ key: row.status, count: row._count._all })),
      requestsByAssistant: byAssistant.map((row) => ({
        key: row.assistantId,
        count: row._count._all,
      })),
      averageDurationMs:
        duration._avg.durationMs === null ? null : Number(duration._avg.durationMs.toFixed(2)),
      durationSamples: duration._count._all,
      usage: {
        records: usage._count._all,
        inputTokens: usage._sum.inputTokens,
        outputTokens: usage._sum.outputTokens,
        totalTokens: usage._sum.totalTokens,
        byStatus: usageStatus.map((row) => ({ key: row.status, count: row._count._all })),
        note: 'Token sums ignore nulls. NOT_AVAILABLE records mean no provider reported usage.',
      },
      validationsByStatus: validations.map((row) => ({
        key: row.status,
        count: row._count._all,
      })),
      conversationsByLanguage: byLanguage.map((row) => ({
        key: row.language,
        count: row._count._all,
      })),
      cropUsage: {
        available: false,
        note: 'Crop-scoped AI usage is not stored on AiUsageRecord; assistant crop links exist but are not aggregated here.',
      },
    };
  }

  async knowledge(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const created = timestampFilter(range);
    const [sourcesByStatus, sourcesByType, jobsByStatus, chunksByStatus, history] =
      await Promise.all([
        this.prisma.knowledgeSource.groupBy({
          by: ['status'],
          where: created ? { createdAt: created } : {},
          _count: { _all: true },
        }),
        this.prisma.knowledgeSource.groupBy({
          by: ['sourceType'],
          where: created ? { createdAt: created } : {},
          _count: { _all: true },
        }),
        this.prisma.knowledgeProcessingJob.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.knowledgeChunk.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.knowledgeProcessingHistory.findMany({
          where: created ? { createdAt: created } : {},
          select: { createdAt: true },
        }),
      ]);

    const succeeded =
      jobsByStatus.find((row) => row.status === KnowledgeJobStatus.COMPLETED)?._count._all ?? 0;
    const failed =
      jobsByStatus.find((row) => row.status === KnowledgeJobStatus.FAILED)?._count._all ?? 0;
    const finished = succeeded + failed;

    return {
      sourcesByStatus: sourcesByStatus.map((row) => ({ key: row.status, count: row._count._all })),
      sourcesByType: sourcesByType.map((row) => ({ key: row.sourceType, count: row._count._all })),
      processingJobsByStatus: jobsByStatus.map((row) => ({
        key: row.status,
        count: row._count._all,
      })),
      processingSuccessRate: finished === 0 ? null : Number((succeeded / finished).toFixed(4)),
      chunksByStatus: chunksByStatus.map((row) => ({ key: row.status, count: row._count._all })),
      approvedSources:
        sourcesByStatus.find((row) => row.status === KnowledgeSourceStatus.APPROVED)?._count._all ??
        0,
      embeddedChunks:
        chunksByStatus.find((row) => row.status === KnowledgeChunkStatus.EMBEDDED)?._count._all ??
        0,
      processingEventsOverTime: seriesFromCounts(
        countByUtcDay(history.map((row) => row.createdAt)),
      ),
      retrieval: {
        available: false,
        note: 'Semantic retrieval counts are unavailable until an embedding provider and vector store are configured. AiRequestKnowledgeReference rows only appear after a successful AI generation.',
      },
    };
  }

  async notifications(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const created = timestampFilter(range);
    const deliveryWhere: Prisma.NotificationDeliveryWhereInput = {
      ...(created ? { createdAt: created } : {}),
      ...(query.notificationChannel ? { channel: query.notificationChannel } : {}),
      ...(query.deliveryStatus ? { status: query.deliveryStatus } : {}),
    };

    const [
      createdNotifications,
      byCategory,
      byChannel,
      byStatus,
      retried,
      unread,
      read,
      createdAts,
      externalDelivered,
    ] = await Promise.all([
      this.prisma.notification.count({ where: created ? { createdAt: created } : {} }),
      this.prisma.notification.groupBy({
        by: ['category'],
        where: created ? { createdAt: created } : {},
        _count: { _all: true },
      }),
      this.prisma.notificationDelivery.groupBy({
        by: ['channel'],
        where: deliveryWhere,
        _count: { _all: true },
      }),
      this.prisma.notificationDelivery.groupBy({
        by: ['status'],
        where: deliveryWhere,
        _count: { _all: true },
      }),
      this.prisma.notificationDelivery.count({
        where: { ...deliveryWhere, attempts: { gt: 1 } },
      }),
      this.prisma.notification.count({ where: { readAt: null, archivedAt: null } }),
      this.prisma.notification.count({ where: { readAt: { not: null } } }),
      this.prisma.notification.findMany({
        where: created ? { createdAt: created } : {},
        select: { createdAt: true },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          ...deliveryWhere,
          status: NotificationDeliveryStatus.DELIVERED,
          channel: { not: NotificationChannel.IN_APP },
        },
      }),
    ]);

    return {
      notificationsCreated: createdNotifications,
      byCategory: byCategory.map((row) => ({ key: row.category, count: row._count._all })),
      deliveriesByChannel: byChannel.map((row) => ({ key: row.channel, count: row._count._all })),
      deliveriesByStatus: byStatus.map((row) => ({ key: row.status, count: row._count._all })),
      deliveriesWithRetries: retried,
      inApp: { unread, read },
      createdOverTime: seriesFromCounts(countByUtcDay(createdAts.map((row) => row.createdAt))),
      externalDeliveredCount: externalDelivered,
      note: 'externalDeliveredCount should stay 0 until a provider receipt path exists. SENT means a provider accepted a message; it is not delivery confirmation.',
    };
  }

  async system(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const created = timestampFilter(range);

    const [
      knowledgeJobs,
      aiQueued,
      notificationQueued,
      aiFailed,
      notificationFailed,
      knowledgeFailed,
      recentAudit,
    ] = await Promise.all([
      this.prisma.knowledgeProcessingJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.aiRequest.count({
        where: {
          status: { in: [AiRequestStatus.QUEUED, AiRequestStatus.PROCESSING] },
        },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          status: {
            in: [NotificationDeliveryStatus.QUEUED, NotificationDeliveryStatus.PROCESSING],
          },
        },
      }),
      this.prisma.aiRequest.count({
        where: {
          status: AiRequestStatus.FAILED,
          ...(created ? { createdAt: created } : {}),
        },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          status: NotificationDeliveryStatus.FAILED,
          ...(created ? { createdAt: created } : {}),
        },
      }),
      this.prisma.knowledgeProcessingJob.count({
        where: { status: KnowledgeJobStatus.FAILED },
      }),
      this.prisma.auditLog.findMany({
        where: created ? { createdAt: created } : {},
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          actorId: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      queueSnapshots: {
        source: 'database',
        note: 'Live BullMQ Redis job counts are not exposed. These figures come from durable request/delivery/job rows.',
        knowledgeProcessingJobs: knowledgeJobs.map((row) => ({
          key: row.status,
          count: row._count._all,
        })),
        aiRequestsInFlight: aiQueued,
        notificationDeliveriesInFlight: notificationQueued,
      },
      failures: {
        aiRequests: aiFailed,
        notificationDeliveries: notificationFailed,
        knowledgeProcessingJobs: knowledgeFailed,
      },
      recentAudit: recentAudit.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actorId: row.actorId,
        createdAt: row.createdAt,
      })),
    };
  }

  /** Tabular registration rows for CSV export (no phone/email). */
  async registrationRows(query: ReportFilterQueryDto) {
    const range = parseDateRange(query.startDate, query.endDate);
    const created = timestampFilter(range);
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        farmerProfile: { isNot: null },
        ...(created ? { createdAt: created } : {}),
        ...(query.province || query.district
          ? {
              location: {
                ...(query.province ? { province: query.province } : {}),
                ...(query.district ? { district: query.district } : {}),
              },
            }
          : {}),
        ...(query.farmerType || query.farmerCategory
          ? {
              farmerProfile: {
                ...(query.farmerType ? { farmerType: query.farmerType } : {}),
                ...(query.farmerCategory ? { farmerCategory: query.farmerCategory } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        preferredLanguage: true,
        farmerProfile: { select: { farmerType: true, farmerCategory: true } },
        location: { select: { province: true, district: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: this.config.csvMaxRows + 1,
    });
  }
}
