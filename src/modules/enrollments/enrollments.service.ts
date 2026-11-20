import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import { EnrollmentStatus, Prisma, RecordStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CoursesService } from '../courses/courses.service';
import { isAdmin } from '../groups/facilitator-groups.service';
import { audiencesForRoles } from '../courses/publication-eligibility';
import { NotificationEvent } from '../notifications/events/notification-events';
import { NotificationPublisher } from '../notifications/publishing/notification-publisher.service';
import { RoleCode } from '../roles/rbac.constants';
import type {
  EnrollmentResponseDto,
  ListEnrollmentsQueryDto,
  UpdateEnrollmentStatusDto,
} from './dto/enrollment.dto';

const enrollmentSelect = {
  id: true,
  userId: true,
  courseId: true,
  status: true,
  enrolledAt: true,
  completedAt: true,
  withdrawnAt: true,
  suspendedAt: true,
  statusReason: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, fullName: true } },
  course: {
    select: { id: true, title: true, language: true, estimatedDurationMinutes: true, status: true },
  },
} satisfies Prisma.CourseEnrollmentSelect;

const detailSelect = {
  ...enrollmentSelect,
  events: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      actorId: true,
      createdAt: true,
    },
  },
} satisfies Prisma.CourseEnrollmentSelect;

type EnrollmentRecord = Prisma.CourseEnrollmentGetPayload<{ select: typeof detailSelect }>;

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
    private readonly notifications: NotificationPublisher,
  ) {}

  async enroll(courseId: string, actor: AuthenticatedUser): Promise<EnrollmentResponseDto> {
    if (audiencesForRoles(actor.roles) === null) {
      throw new ForbiddenException('Only a farmer can enroll in a course');
    }
    await this.courses.findOne(courseId, actor);
    const existing = await this.prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId: actor.id, courseId } },
      select: { id: true, status: true },
    });
    if (existing?.status === EnrollmentStatus.ACTIVE) {
      throw new ConflictException('You are already enrolled in this course');
    }
    if (existing?.status === EnrollmentStatus.COMPLETED) {
      throw new ConflictException('This course is already completed');
    }
    if (existing?.status === EnrollmentStatus.SUSPENDED) {
      throw new ConflictException('This enrollment is suspended');
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const enrollment = existing
        ? await tx.courseEnrollment.update({
            where: { id: existing.id },
            data: { status: EnrollmentStatus.ACTIVE, withdrawnAt: null, statusReason: null },
            select: detailSelect,
          })
        : await tx.courseEnrollment.create({
            data: { userId: actor.id, courseId, status: EnrollmentStatus.ACTIVE },
            select: detailSelect,
          });
      await tx.enrollmentEvent.create({
        data: {
          enrollmentId: enrollment.id,
          fromStatus: existing?.status ?? null,
          toStatus: EnrollmentStatus.ACTIVE,
          actorId: actor.id,
        },
      });
      return tx.courseEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
        select: detailSelect,
      });
    });
    await this.notifications.notifyEvent(
      NotificationEvent.CourseEnrolled,
      actor.id,
      { courseTitle: saved.course.title },
      { entity: { type: 'course', id: courseId } },
    );
    return saved;
  }

  async list(
    query: ListEnrollmentsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Paginated<EnrollmentResponseDto>> {
    const where = await this.listWhere(query, actor);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.courseEnrollment.findMany({
        where,
        select: enrollmentSelect,
        orderBy: { enrolledAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.courseEnrollment.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<EnrollmentResponseDto> {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { id },
      select: detailSelect,
    });
    if (!enrollment || !(await this.canRead(enrollment, actor)))
      throw new NotFoundException('Enrollment not found');
    return enrollment;
  }

  async withdraw(id: string, actor: AuthenticatedUser): Promise<EnrollmentResponseDto> {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!enrollment || (enrollment.userId !== actor.id && !isAdmin(actor))) {
      throw new NotFoundException('Enrollment not found');
    }
    if (enrollment.status !== EnrollmentStatus.ACTIVE) {
      throw new ConflictException('Only an active enrollment can be withdrawn');
    }
    return this.changeStatus(
      enrollment.id,
      enrollment.status,
      EnrollmentStatus.WITHDRAWN,
      actor.id,
      null,
    );
  }

  async updateStatus(
    id: string,
    dto: UpdateEnrollmentStatusDto,
    actor: AuthenticatedUser,
  ): Promise<EnrollmentResponseDto> {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.status === dto.status) {
      throw new ConflictException('The enrollment already has this status');
    }
    return this.changeStatus(
      enrollment.id,
      enrollment.status,
      dto.status,
      actor.id,
      dto.reason ?? null,
    );
  }

  /** Active or completed enrollment. Missing enrollments are reported as not found by the caller. */
  async studyState(userId: string, courseId: string): Promise<'ok' | 'blocked' | 'none'> {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { status: true },
    });
    if (!enrollment) return 'none';
    if (
      enrollment.status === EnrollmentStatus.ACTIVE ||
      enrollment.status === EnrollmentStatus.COMPLETED
    )
      return 'ok';
    return 'blocked';
  }

  async requireActive(userId: string, courseId: string): Promise<void> {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { status: true },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.status !== EnrollmentStatus.ACTIVE) {
      throw new ForbiddenException('An active enrollment is required');
    }
  }

  private async changeStatus(
    id: string,
    from: EnrollmentStatus,
    to: EnrollmentStatus,
    actorId: string,
    reason: string | null,
  ): Promise<EnrollmentResponseDto> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.courseEnrollment.update({
        where: { id },
        data: {
          status: to,
          statusReason: reason,
          completedAt:
            to === EnrollmentStatus.COMPLETED
              ? now
              : to === EnrollmentStatus.ACTIVE
                ? null
                : undefined,
          withdrawnAt:
            to === EnrollmentStatus.WITHDRAWN
              ? now
              : to === EnrollmentStatus.ACTIVE
                ? null
                : undefined,
          suspendedAt:
            to === EnrollmentStatus.SUSPENDED
              ? now
              : to === EnrollmentStatus.ACTIVE
                ? null
                : undefined,
        },
      });
      await tx.enrollmentEvent.create({
        data: { enrollmentId: id, fromStatus: from, toStatus: to, actorId, reason },
      });
      return tx.courseEnrollment.findUniqueOrThrow({ where: { id }, select: detailSelect });
    });
  }

  private async listWhere(
    query: ListEnrollmentsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Prisma.CourseEnrollmentWhereInput> {
    const where: Prisma.CourseEnrollmentWhereInput = {};
    if (query.courseId) where.courseId = query.courseId;
    if (query.status) where.status = query.status;
    if (isAdmin(actor)) {
      if (query.userId) where.userId = query.userId;
      return where;
    }
    if (audiencesForRoles(actor.roles) !== null && !actor.roles.includes(RoleCode.Facilitator)) {
      where.userId = actor.id;
      return where;
    }
    where.user = {
      facilitatorGroupMemberships: {
        some: { group: { facilitatorId: actor.id, status: RecordStatus.ACTIVE } },
      },
    };
    if (query.userId) where.userId = query.userId;
    return where;
  }

  private async canRead(enrollment: EnrollmentRecord, actor: AuthenticatedUser): Promise<boolean> {
    if (isAdmin(actor) || enrollment.userId === actor.id) return true;
    if (!actor.roles.includes(RoleCode.Facilitator)) return false;
    const membership = await this.prisma.facilitatorGroupMember.findFirst({
      where: {
        userId: enrollment.userId,
        group: { facilitatorId: actor.id, status: RecordStatus.ACTIVE },
      },
      select: { userId: true },
    });
    return membership !== null;
  }
}
