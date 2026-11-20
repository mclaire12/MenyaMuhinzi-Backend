import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  LearningSessionStatus,
  LessonProgressStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CoursesService } from '../courses/courses.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { isAdmin } from '../groups/facilitator-groups.service';
import { RoleCode } from '../roles/rbac.constants';
import type {
  CourseProgressResponseDto,
  LearningSessionResponseDto,
  LessonContentResponseDto,
  LessonProgressResponseDto,
  StartLearningSessionDto,
  UpdateLessonProgressDto,
} from './dto/progress.dto';
import { nextProgressState, summarizeCourseProgress } from './progress-summary';

const progressSelect = {
  id: true,
  userId: true,
  courseId: true,
  moduleId: true,
  lessonId: true,
  status: true,
  progressPercentage: true,
  timeSpentSeconds: true,
  startedAt: true,
  lastAccessedAt: true,
  completedAt: true,
  lastChannel: true,
} satisfies Prisma.LessonProgressSelect;

const sessionSelect = {
  id: true,
  userId: true,
  courseId: true,
  lessonId: true,
  channel: true,
  status: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
} satisfies Prisma.LearningSessionSelect;

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  async updateLesson(lessonId: string, dto: UpdateLessonProgressDto, actor: AuthenticatedUser): Promise<LessonProgressResponseDto> {
    const lesson = await this.lessonCourse(lessonId);
    await this.enrollments.requireActive(actor.id, lesson.courseId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.lessonProgress.findUnique({
          where: { userId_lessonId: { userId: actor.id, lessonId } },
          select: progressSelect,
        });
        const next = nextProgressState(
          { percentage: current?.progressPercentage ?? 0, status: current?.status ?? LessonProgressStatus.NOT_STARTED },
          dto.progressPercentage,
        );
        if (dto.status && dto.status !== next.status) {
          throw new BadRequestException('Progress status does not match the percentage');
        }
        const now = new Date();
        const saved = await tx.lessonProgress.upsert({
          where: { userId_lessonId: { userId: actor.id, lessonId } },
          create: {
            userId: actor.id,
            courseId: lesson.courseId,
            moduleId: lesson.moduleId,
            lessonId,
            status: next.status,
            progressPercentage: next.percentage,
            startedAt: next.status === LessonProgressStatus.NOT_STARTED ? null : now,
            lastAccessedAt: now,
            completedAt: next.status === LessonProgressStatus.COMPLETED ? now : null,
            lastChannel: dto.channel,
          },
          update: {
            status: next.status,
            progressPercentage: next.percentage,
            startedAt: current?.startedAt ?? now,
            lastAccessedAt: now,
            completedAt: next.status === LessonProgressStatus.COMPLETED ? (current?.completedAt ?? now) : current?.completedAt,
            lastChannel: dto.channel ?? current?.lastChannel,
          },
          select: progressSelect,
        });
        if (next.status === LessonProgressStatus.COMPLETED) {
          await this.completeCourseIfDone(tx, actor.id, lesson.courseId);
        }
        return saved;
      });
    } catch (error) {
      if (error instanceof Error && /percentage|backwards/.test(error.message)) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async courseProgress(enrollmentId: string, actor: AuthenticatedUser): Promise<CourseProgressResponseDto> {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true, userId: true, courseId: true },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    await this.enrollments.findOne(enrollment.id, actor);
    const [lessons, progress] = await Promise.all([
      this.prisma.lesson.findMany({
        where: { module: { courseId: enrollment.courseId } },
        select: { id: true, moduleId: true },
        orderBy: { displayOrder: 'asc' },
      }),
      this.prisma.lessonProgress.findMany({
        where: { userId: enrollment.userId, courseId: enrollment.courseId },
        select: progressSelect,
      }),
    ]);
    const summary = summarizeCourseProgress(lessons, progress);
    return { enrollmentId: enrollment.id, courseId: enrollment.courseId, ...summary, lessons: progress };
  }

  async startSession(dto: StartLearningSessionDto, actor: AuthenticatedUser): Promise<LearningSessionResponseDto> {
    const lesson = await this.lessonCourse(dto.lessonId);
    await this.enrollments.requireActive(actor.id, lesson.courseId);
    const open = await this.prisma.learningSession.findFirst({
      where: { userId: actor.id, lessonId: dto.lessonId, status: LearningSessionStatus.ACTIVE },
      select: { id: true },
    });
    if (open) throw new ConflictException('A learning session is already open for this lesson');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const session = await tx.learningSession.create({
          data: {
            userId: actor.id,
            courseId: lesson.courseId,
            lessonId: dto.lessonId,
            channel: dto.channel,
          },
          select: sessionSelect,
        });
        const current = await tx.lessonProgress.findUnique({
          where: { userId_lessonId: { userId: actor.id, lessonId: dto.lessonId } },
          select: { status: true, startedAt: true },
        });
        if (!current) {
          await tx.lessonProgress.create({
            data: {
              userId: actor.id,
              courseId: lesson.courseId,
              moduleId: lesson.moduleId,
              lessonId: dto.lessonId,
              status: LessonProgressStatus.IN_PROGRESS,
              startedAt: now,
              lastAccessedAt: now,
              lastChannel: dto.channel,
            },
          });
        } else {
          await tx.lessonProgress.update({
            where: { userId_lessonId: { userId: actor.id, lessonId: dto.lessonId } },
            data: {
              status: current.status === LessonProgressStatus.COMPLETED ? current.status : LessonProgressStatus.IN_PROGRESS,
              startedAt: current.startedAt ?? now,
              lastAccessedAt: now,
              lastChannel: dto.channel,
            },
          });
        }
        return session;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A learning session is already open for this lesson');
      }
      throw error;
    }
  }

  async completeSession(id: string, actor: AuthenticatedUser): Promise<LearningSessionResponseDto> {
    return this.endSession(id, actor, LearningSessionStatus.COMPLETED);
  }

  async abandonSession(id: string, actor: AuthenticatedUser): Promise<LearningSessionResponseDto> {
    return this.endSession(id, actor, LearningSessionStatus.ABANDONED);
  }

  async lessonContent(lessonId: string, actor: AuthenticatedUser): Promise<LessonContentResponseDto> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        moduleId: true,
        title: true,
        description: true,
        learningObjectives: true,
        lessonType: true,
        mainContent: true,
        contentRef: true,
        language: true,
        estimatedDurationMinutes: true,
        displayOrder: true,
        status: true,
        module: { select: { courseId: true } },
        resources: { orderBy: { displayOrder: 'asc' } },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.assertCanReadContent(lesson.module.courseId, actor);
    return {
      id: lesson.id,
      moduleId: lesson.moduleId,
      courseId: lesson.module.courseId,
      title: lesson.title,
      description: lesson.description,
      learningObjectives: lesson.learningObjectives,
      lessonType: lesson.lessonType,
      mainContent: lesson.mainContent,
      contentRef: lesson.contentRef,
      language: lesson.language,
      estimatedDurationMinutes: lesson.estimatedDurationMinutes,
      displayOrder: lesson.displayOrder,
      status: lesson.status,
      resources: lesson.resources,
    };
  }

  private async endSession(
    id: string,
    actor: AuthenticatedUser,
    status: LearningSessionStatus,
  ): Promise<LearningSessionResponseDto> {
    const session = await this.prisma.learningSession.findUnique({ where: { id }, select: sessionSelect });
    if (!session || session.userId !== actor.id) throw new NotFoundException('Learning session not found');
    if (session.status !== LearningSessionStatus.ACTIVE) {
      throw new ConflictException('This learning session is already closed');
    }
    const endedAt = new Date();
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000));
    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.learningSession.update({
        where: { id },
        data: { status, endedAt, durationSeconds },
        select: sessionSelect,
      });
      await tx.lessonProgress.update({
        where: { userId_lessonId: { userId: actor.id, lessonId: session.lessonId } },
        data: {
          timeSpentSeconds: { increment: durationSeconds },
          lastAccessedAt: endedAt,
          lastChannel: session.channel,
        },
      });
      return closed;
    });
  }

  private async assertCanReadContent(courseId: string, actor: AuthenticatedUser): Promise<void> {
    if (isAdmin(actor)) return;
    if (actor.roles.includes(RoleCode.Facilitator)) {
      await this.courses.findOne(courseId, actor);
      return;
    }
    const state = await this.enrollments.studyState(actor.id, courseId);
    if (state === 'none') throw new NotFoundException('Lesson not found');
    if (state === 'blocked') throw new ForbiddenException('This enrollment cannot open lesson content');
  }

  private async lessonCourse(lessonId: string): Promise<{ courseId: string; moduleId: string }> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { moduleId: true, module: { select: { courseId: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    return { courseId: lesson.module.courseId, moduleId: lesson.moduleId };
  }

  private async completeCourseIfDone(tx: Prisma.TransactionClient, userId: string, courseId: string): Promise<void> {
    const lessons = await tx.lesson.findMany({ where: { module: { courseId } }, select: { id: true } });
    if (lessons.length === 0) return;
    const completed = await tx.lessonProgress.count({
      where: {
        userId,
        courseId,
        status: LessonProgressStatus.COMPLETED,
        lessonId: { in: lessons.map((lesson) => lesson.id) },
      },
    });
    if (completed !== lessons.length) return;
    const updated = await tx.courseEnrollment.updateMany({
      where: { userId, courseId, status: EnrollmentStatus.ACTIVE },
      data: { status: EnrollmentStatus.COMPLETED, completedAt: new Date() },
    });
    if (updated.count !== 1) return;
    const enrollment = await tx.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { id: true },
    });
    if (!enrollment) return;
    await tx.enrollmentEvent.create({
      data: {
        enrollmentId: enrollment.id,
        fromStatus: EnrollmentStatus.ACTIVE,
        toStatus: EnrollmentStatus.COMPLETED,
        actorId: userId,
        reason: 'All lessons completed',
      },
    });
  }
}
