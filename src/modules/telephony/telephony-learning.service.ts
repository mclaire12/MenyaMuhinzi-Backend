import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AttemptStatus,
  ContentStatus,
  CourseStatus,
  EnrollmentStatus,
  Language,
  LearningChannel,
  LearningSessionStatus,
  LessonProgressStatus,
  QuestionType,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CoursesService } from '../courses/courses.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { ProgressService } from '../progress/progress.service';
import { AssessmentsService } from '../assessments/assessments.service';
import type { AssessmentResponseDto, SubmitAttemptDto } from '../assessments/dto/assessment.dto';
import { paginatePlainText } from './content-pagination';

export interface TelephonyCourseOption {
  id: string;
  title: string;
  activeEnrollment: boolean;
  completedEnrollment: boolean;
}

export interface TelephonyModuleOption {
  id: string;
  title: string;
}

export interface TelephonyLessonOption {
  id: string;
  title: string;
}

export interface TelephonyAssessmentQuestion {
  id: string;
  text: string;
  questionType: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  options: { id: string; text: string }[];
}

export interface TelephonyAssessmentOption {
  id: string;
  title: string;
  questions: TelephonyAssessmentQuestion[];
}

@Injectable()
export class TelephonyLearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
    private readonly enrollments: EnrollmentsService,
    private readonly progress: ProgressService,
    private readonly assessments: AssessmentsService,
  ) {}

  async listCourses(actor: AuthenticatedUser): Promise<TelephonyCourseOption[]> {
    const catalogue = await this.courses.list({ page: 1, limit: 100 }, actor);
    const visibleCourses = [...catalogue.data];
    for (let page = 2; page <= catalogue.meta.totalPages; page += 1) {
      const next = await this.courses.list({ page, limit: 100 }, actor);
      visibleCourses.push(...next.data);
    }
    const enrolled = await this.prisma.courseEnrollment.findMany({
      where: {
        userId: actor.id,
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      },
      select: { courseId: true, status: true },
    });
    const activeIds = new Set(
      enrolled.filter((row) => row.status === EnrollmentStatus.ACTIVE).map((row) => row.courseId),
    );
    const completedIds = new Set(
      enrolled
        .filter((row) => row.status === EnrollmentStatus.COMPLETED)
        .map((row) => row.courseId),
    );
    return visibleCourses.map((course) => ({
      id: course.id,
      title: course.title,
      activeEnrollment: activeIds.has(course.id),
      completedEnrollment: completedIds.has(course.id),
    }));
  }

  async listModules(courseId: string, actor: AuthenticatedUser): Promise<TelephonyModuleOption[]> {
    await this.courses.findOne(courseId, actor);
    return this.prisma.courseModule.findMany({
      where: { courseId, status: ContentStatus.PUBLISHED },
      select: { id: true, title: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async listLessons(moduleId: string, actor: AuthenticatedUser): Promise<TelephonyLessonOption[]> {
    const module = await this.prisma.courseModule.findUnique({
      where: { id: moduleId },
      select: { courseId: true, status: true },
    });
    if (!module || module.status !== ContentStatus.PUBLISHED) return [];
    await this.courses.findOne(module.courseId, actor);
    return this.prisma.lesson.findMany({
      where: { moduleId, status: ContentStatus.PUBLISHED },
      select: { id: true, title: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async enroll(courseId: string, actor: AuthenticatedUser): Promise<void> {
    await this.enrollments.enroll(courseId, actor);
  }

  async startLesson(
    lessonId: string,
    channel: LearningChannel,
    actor: AuthenticatedUser,
  ): Promise<string> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        status: true,
        module: { select: { status: true, courseId: true } },
      },
    });
    if (
      !lesson ||
      lesson.status !== ContentStatus.PUBLISHED ||
      lesson.module.status !== ContentStatus.PUBLISHED
    ) {
      throw new NotFoundException('Lesson not found');
    }
    await this.courses.findOne(lesson.module.courseId, actor);
    await this.enrollments.requireActive(actor.id, lesson.module.courseId);

    const open = await this.prisma.learningSession.findFirst({
      where: {
        userId: actor.id,
        lessonId,
        status: LearningSessionStatus.ACTIVE,
      },
      select: { id: true, channel: true },
    });
    if (open?.channel === channel) return open.id;
    if (open) await this.progress.abandonSession(open.id, actor);
    const session = await this.progress.startSession({ lessonId, channel }, actor);
    return session.id;
  }

  async closeLessonSession(
    learningSessionId: string | null | undefined,
    actor: AuthenticatedUser,
    completed: boolean,
  ): Promise<void> {
    if (!learningSessionId) return;
    if (completed) {
      await this.progress.completeSession(learningSessionId, actor);
      return;
    }
    await this.progress.abandonSession(learningSessionId, actor);
  }

  async listAssessments(
    courseId: string,
    actor: AuthenticatedUser,
  ): Promise<TelephonyAssessmentOption[]> {
    await this.courses.findOne(courseId, actor);
    const enrollmentState = await this.enrollments.studyState(actor.id, courseId);
    if (enrollmentState === 'none') return [];
    if (enrollmentState === 'blocked') {
      throw new NotFoundException('Assessment not found');
    }

    const [modules, lessons] = await Promise.all([
      this.prisma.courseModule.findMany({
        where: { courseId, status: ContentStatus.PUBLISHED },
        select: { id: true },
      }),
      this.prisma.lesson.findMany({
        where: {
          status: ContentStatus.PUBLISHED,
          module: { courseId, status: ContentStatus.PUBLISHED },
        },
        select: { id: true },
      }),
    ]);
    const results = await Promise.all([
      this.assessments.list({ courseId }, actor),
      ...modules.map((module) => this.assessments.list({ moduleId: module.id }, actor)),
      ...lessons.map((lesson) => this.assessments.list({ lessonId: lesson.id }, actor)),
    ]);
    const seen = new Set<string>();
    const uniqueAssessments = results.flat().filter((assessment) => {
      if (seen.has(assessment.id)) return false;
      seen.add(assessment.id);
      return true;
    });
    return uniqueAssessments
      .filter(
        (assessment) =>
          assessment.questions.length > 0 && assessment.questions.every(isTelephonyQuestion),
      )
      .map((assessment) => ({
        id: assessment.id,
        title: assessment.title,
        questions: assessment.questions.filter(isTelephonyQuestion).map((question) => ({
          id: question.id,
          text: question.text,
          questionType: question.questionType,
          options: question.options ?? [],
        })),
      }));
  }

  startAssessment(assessmentId: string, actor: AuthenticatedUser) {
    return this.prisma.assessmentAttempt
      .findFirst({
        where: { assessmentId, userId: actor.id, status: AttemptStatus.IN_PROGRESS },
        select: { id: true },
      })
      .then((active) => active ?? this.assessments.start(assessmentId, actor));
  }

  submitAssessmentAttempt(attemptId: string, dto: SubmitAttemptDto, actor: AuthenticatedUser) {
    return this.assessments.submit(attemptId, dto, actor);
  }

  async lessonContentPage(
    lessonId: string,
    page: number,
    maxChars: number,
    actor: AuthenticatedUser,
  ): Promise<{ title: string; body: string; page: number; total: number }> {
    const content = await this.progress.lessonContent(lessonId, actor);
    const pages = paginatePlainText(content.mainContent ?? content.description ?? '', maxChars);
    const index = Math.min(Math.max(page, 1), pages.total) - 1;
    return {
      title: content.title,
      body: pages.pages[index] ?? '',
      page: index + 1,
      total: pages.total,
    };
  }

  async markLessonComplete(
    lessonId: string,
    channel: LearningChannel,
    actor: AuthenticatedUser,
  ): Promise<void> {
    await this.progress.updateLesson(
      lessonId,
      { progressPercentage: 100, channel, status: LessonProgressStatus.COMPLETED },
      actor,
    );
  }

  async continueLearning(
    actor: AuthenticatedUser,
  ): Promise<{ courseId: string; lessonId: string } | null> {
    const activeCourses = await this.prisma.courseEnrollment.findMany({
      where: {
        userId: actor.id,
        status: EnrollmentStatus.ACTIVE,
        course: { status: CourseStatus.PUBLISHED },
      },
      select: { courseId: true },
    });
    if (activeCourses.length === 0) return null;
    const progress = await this.prisma.lessonProgress.findFirst({
      where: {
        userId: actor.id,
        courseId: { in: activeCourses.map((enrollment) => enrollment.courseId) },
        status: { in: [LessonProgressStatus.IN_PROGRESS, LessonProgressStatus.NOT_STARTED] },
        lesson: { status: ContentStatus.PUBLISHED, module: { status: ContentStatus.PUBLISHED } },
      },
      orderBy: { lastAccessedAt: 'desc' },
      select: { lessonId: true, courseId: true },
    });
    if (progress) await this.courses.findOne(progress.courseId, actor);
    return progress ? { courseId: progress.courseId, lessonId: progress.lessonId } : null;
  }

  async progressSummary(
    actor: AuthenticatedUser,
    language: Language = Language.en,
  ): Promise<string> {
    const enrollments = await this.prisma.courseEnrollment.count({
      where: { userId: actor.id, status: EnrollmentStatus.ACTIVE },
    });
    const completed = await this.prisma.lessonProgress.count({
      where: { userId: actor.id, status: LessonProgressStatus.COMPLETED },
    });
    return language === Language.rw
      ? `Amasomo akomeje: ${enrollments}. Amasomo arangiye: ${completed}.`
      : `${enrollments} active courses, ${completed} lessons completed`;
  }
}

function isTelephonyQuestion(
  question: AssessmentResponseDto['questions'][number],
): question is AssessmentResponseDto['questions'][number] & {
  questionType: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
} {
  return (
    question.questionType === QuestionType.MULTIPLE_CHOICE ||
    question.questionType === QuestionType.TRUE_FALSE
  );
}
