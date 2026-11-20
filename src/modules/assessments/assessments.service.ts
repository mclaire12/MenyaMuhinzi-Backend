import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import {
  AssessmentStatus,
  AttemptStatus,
  Prisma,
  QuestionType,
  RecordStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CoursesService } from '../courses/courses.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { audiencesForRoles } from '../courses/publication-eligibility';
import { isAdmin } from '../groups/facilitator-groups.service';
import { NotificationEvent } from '../notifications/events/notification-events';
import { NotificationPublisher } from '../notifications/publishing/notification-publisher.service';
import { RoleCode } from '../roles/rbac.constants';
import type {
  AssessmentResponseDto,
  AttemptResponseDto,
  CreateAssessmentDto,
  CreateQuestionDto,
  ListAssessmentsQueryDto,
  ListAttemptsQueryDto,
  QuestionResponseDto,
  ReviewAttemptDto,
  SubmitAttemptDto,
  UpdateAssessmentDto,
} from './dto/assessment.dto';
import { gradeResponse, summarizeAttempt } from './grading';

const questionSelect = {
  id: true,
  text: true,
  questionType: true,
  options: true,
  correctAnswer: true,
  marks: true,
  explanation: true,
  displayOrder: true,
} satisfies Prisma.AssessmentQuestionSelect;

const assessmentSelect = {
  id: true,
  title: true,
  description: true,
  courseId: true,
  moduleId: true,
  lessonId: true,
  passingScore: true,
  maxAttempts: true,
  timeLimitMinutes: true,
  language: true,
  status: true,
  createdAt: true,
  questions: { orderBy: { displayOrder: 'asc' as const }, select: questionSelect },
} satisfies Prisma.AssessmentSelect;

type AssessmentRecord = Prisma.AssessmentGetPayload<{ select: typeof assessmentSelect }>;
type QuestionRecord = AssessmentRecord['questions'][number];

@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
    private readonly enrollments: EnrollmentsService,
    private readonly notifications: NotificationPublisher,
  ) {}

  async create(dto: CreateAssessmentDto, actor: AuthenticatedUser): Promise<AssessmentResponseDto> {
    const parent = this.oneParent(dto);
    await this.assertParentExists(parent);
    if (
      (dto.status ?? AssessmentStatus.DRAFT) === AssessmentStatus.PUBLISHED &&
      (dto.questions?.length ?? 0) === 0
    ) {
      throw new BadRequestException('A published assessment needs at least one question');
    }
    const assessment = await this.prisma.assessment.create({
      data: {
        title: dto.title,
        description: dto.description,
        ...parent,
        passingScore: dto.passingScore,
        maxAttempts: dto.maxAttempts ?? 3,
        timeLimitMinutes: dto.timeLimitMinutes,
        language: dto.language,
        status: dto.status,
        createdById: actor.id,
        questions: dto.questions
          ? { create: dto.questions.map((question, index) => this.questionData(question, index)) }
          : undefined,
      },
      select: assessmentSelect,
    });
    return this.present(assessment, true);
  }

  async list(
    query: ListAssessmentsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<AssessmentResponseDto[]> {
    if (!query.courseId && !query.moduleId && !query.lessonId) {
      throw new BadRequestException('Filter by a course, module, or lesson');
    }
    const courseId = await this.courseIdFromQuery(query);
    await this.assertCanSeeCourse(courseId, actor);
    const reveal = this.canReview(actor);
    const rows = await this.prisma.assessment.findMany({
      where: {
        courseId: query.courseId,
        moduleId: query.moduleId,
        lessonId: query.lessonId,
        status: reveal ? undefined : AssessmentStatus.PUBLISHED,
      },
      select: assessmentSelect,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.present(row, reveal));
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<AssessmentResponseDto> {
    const assessment = await this.load(id);
    await this.assertCanSeeCourse(await this.courseIdOf(assessment), actor);
    if (!this.canReview(actor) && assessment.status !== AssessmentStatus.PUBLISHED) {
      throw new NotFoundException('Assessment not found');
    }
    return this.present(assessment, this.canReview(actor));
  }

  async update(id: string, dto: UpdateAssessmentDto): Promise<AssessmentResponseDto> {
    const existing = await this.load(id);
    if (dto.status === AssessmentStatus.PUBLISHED && existing.questions.length === 0) {
      throw new BadRequestException('A published assessment needs at least one question');
    }
    const assessment = await this.prisma.assessment.update({
      where: { id },
      data: dto,
      select: assessmentSelect,
    });
    return this.present(assessment, true);
  }

  async addQuestion(assessmentId: string, dto: CreateQuestionDto): Promise<QuestionResponseDto> {
    await this.load(assessmentId);
    const order = dto.displayOrder ?? (await this.nextOrder(assessmentId));
    const question = await this.prisma.assessmentQuestion.create({
      data: { assessmentId, ...this.questionData(dto, order) },
      select: questionSelect,
    });
    return this.presentQuestion(question, true);
  }

  async updateQuestion(id: string, dto: CreateQuestionDto): Promise<QuestionResponseDto> {
    const existing = await this.prisma.assessmentQuestion.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Question not found');
    const question = await this.prisma.assessmentQuestion.update({
      where: { id },
      data: this.questionData(dto, dto.displayOrder ?? 0),
      select: questionSelect,
    });
    return this.presentQuestion(question, true);
  }

  async removeQuestion(id: string): Promise<void> {
    try {
      await this.prisma.assessmentQuestion.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Question not found');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('A question that has been answered is kept');
      }
      throw error;
    }
  }

  async start(assessmentId: string, actor: AuthenticatedUser): Promise<AttemptResponseDto> {
    const assessment = await this.load(assessmentId);
    if (assessment.status !== AssessmentStatus.PUBLISHED)
      throw new NotFoundException('Assessment not found');
    await this.assertMayAttempt(actor.id, await this.courseIdOf(assessment));
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.assessmentAttempt.findFirst({
        where: { assessmentId, userId: actor.id, status: AttemptStatus.IN_PROGRESS },
        select: { id: true },
      });
      if (open) throw new ConflictException('Finish the open attempt before starting another');
      const used = await tx.assessmentAttempt.count({
        where: { assessmentId, userId: actor.id, status: { not: AttemptStatus.IN_PROGRESS } },
      });
      if (used >= assessment.maxAttempts) throw new ConflictException('Maximum attempts reached');
      const attempt = await tx.assessmentAttempt.create({
        data: { assessmentId, userId: actor.id, attemptNumber: used + 1 },
      });
      return this.presentAttempt(attempt, []);
    });
  }

  async submit(
    attemptId: string,
    dto: SubmitAttemptDto,
    actor: AuthenticatedUser,
  ): Promise<AttemptResponseDto> {
    const attempt = await this.prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: { assessment: { select: assessmentSelect } },
    });
    if (!attempt || attempt.userId !== actor.id) throw new NotFoundException('Attempt not found');
    if (attempt.status !== AttemptStatus.IN_PROGRESS)
      throw new ConflictException('This attempt is already submitted');
    const questions = attempt.assessment.questions;
    if (dto.answers.length !== questions.length) {
      throw new BadRequestException('Answer every question once');
    }
    const byId = new Map(dto.answers.map((answer) => [answer.questionId, answer]));
    if (byId.size !== questions.length) throw new BadRequestException('Answer every question once');

    const graded = questions.map((question) => {
      const answer = byId.get(question.id);
      if (!answer) throw new BadRequestException('Answer every question once');
      try {
        const response = this.responseValue(question, answer);
        const result = gradeResponse(
          { ...question, options: this.optionsOf(question.options) },
          response,
        );
        return { question, response, ...result };
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid answer');
      }
    });
    const submittedAt = new Date();
    const timedOut = this.timedOut(
      attempt.assessment.timeLimitMinutes,
      attempt.startedAt,
      submittedAt,
    );
    const summary = summarizeAttempt(
      graded.map((item) => ({ awardedMarks: item.awardedMarks, marks: item.question.marks })),
      attempt.assessment.passingScore,
      timedOut,
    );
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.assessmentAnswer.createMany({
        data: graded.map((item) => ({
          attemptId,
          questionId: item.question.id,
          response: item.response as Prisma.InputJsonValue,
          awardedMarks: item.awardedMarks,
        })),
      });
      return tx.assessmentAttempt.update({
        where: { id: attemptId },
        data: { ...summary, timedOut, status: summary.status, submittedAt },
        include: { answers: { include: { question: { select: questionSelect } } } },
      });
    });
    return this.presentAttempt(saved, saved.answers, true);
  }

  async review(
    attemptId: string,
    dto: ReviewAttemptDto,
    actor: AuthenticatedUser,
  ): Promise<AttemptResponseDto> {
    const attempt = await this.prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: { select: { passingScore: true, timeLimitMinutes: true, title: true } },
        answers: { include: { question: { select: questionSelect } } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!(await this.canReviewUser(actor, attempt.userId)))
      throw new NotFoundException('Attempt not found');
    if (attempt.status !== AttemptStatus.PENDING_REVIEW) {
      throw new ConflictException('This attempt is not waiting for review');
    }
    const pending = attempt.answers.filter(
      (answer) => answer.question.questionType === QuestionType.SHORT_ANSWER,
    );
    if (dto.grades.length !== pending.length)
      throw new BadRequestException('Score every short answer');
    const grades = new Map(dto.grades.map((grade) => [grade.questionId, grade.awardedMarks]));
    for (const answer of pending) {
      const awarded = grades.get(answer.questionId);
      if (awarded === undefined || awarded > answer.question.marks) {
        throw new BadRequestException('Awarded marks must be between 0 and the question marks');
      }
    }
    const saved = await this.prisma.$transaction(async (tx) => {
      for (const answer of pending) {
        await tx.assessmentAnswer.update({
          where: { id: answer.id },
          data: { awardedMarks: grades.get(answer.questionId) },
        });
      }
      const answers = await tx.assessmentAnswer.findMany({
        where: { attemptId },
        include: { question: { select: questionSelect } },
      });
      const summary = summarizeAttempt(
        answers.map((answer) => ({
          awardedMarks: answer.awardedMarks,
          marks: answer.question.marks,
        })),
        attempt.assessment.passingScore,
        attempt.timedOut,
      );
      return tx.assessmentAttempt.update({
        where: { id: attemptId },
        data: summary,
        include: { answers: { include: { question: { select: questionSelect } } } },
      });
    });
    await this.notifications.notifyEvent(
      NotificationEvent.AssessmentReviewed,
      attempt.userId,
      { assessmentTitle: attempt.assessment.title },
      { entity: { type: 'assessment-attempt', id: attemptId } },
    );
    return this.presentAttempt(saved, saved.answers, true);
  }

  async listAttempts(
    query: ListAttemptsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Paginated<AttemptResponseDto>> {
    const where = await this.attemptWhere(query, actor);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.assessmentAttempt.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.assessmentAttempt.count({ where }),
    ]);
    return paginated(
      rows.map((row) => this.presentAttempt(row, [])),
      total,
      query,
    );
  }

  async findAttempt(id: string, actor: AuthenticatedUser): Promise<AttemptResponseDto> {
    const attempt = await this.prisma.assessmentAttempt.findUnique({
      where: { id },
      include: { answers: { include: { question: { select: questionSelect } } } },
    });
    if (!attempt || !(await this.canReadAttempt(actor, attempt.userId)))
      throw new NotFoundException('Attempt not found');
    const reveal = attempt.status !== AttemptStatus.IN_PROGRESS;
    return this.presentAttempt(attempt, attempt.answers, reveal);
  }

  private questionData(
    dto: CreateQuestionDto,
    displayOrder: number,
  ): Prisma.AssessmentQuestionCreateWithoutAssessmentInput {
    const marks = dto.marks ?? 1;
    if (dto.questionType === QuestionType.MULTIPLE_CHOICE) {
      if (
        !dto.options ||
        dto.correctOptionIndex === undefined ||
        dto.correctOptionIndex >= dto.options.length
      ) {
        throw new BadRequestException('Multiple choice needs options and a correct option');
      }
      const options = dto.options.map((text) => ({ id: randomUUID(), text: text.trim() }));
      return {
        text: dto.text,
        questionType: dto.questionType,
        options,
        correctAnswer: options[dto.correctOptionIndex].id,
        marks,
        explanation: dto.explanation,
        displayOrder: dto.displayOrder ?? displayOrder,
      };
    }
    if (dto.questionType === QuestionType.TRUE_FALSE) {
      if (dto.correctBoolean === undefined)
        throw new BadRequestException('True/false needs a correct answer');
      return {
        text: dto.text,
        questionType: dto.questionType,
        correctAnswer: dto.correctBoolean,
        marks,
        explanation: dto.explanation,
        displayOrder: dto.displayOrder ?? displayOrder,
      };
    }
    return {
      text: dto.text,
      questionType: dto.questionType,
      marks,
      explanation: dto.explanation,
      displayOrder: dto.displayOrder ?? displayOrder,
    };
  }

  private responseValue(
    question: QuestionRecord,
    answer: SubmitAttemptDto['answers'][number],
  ): unknown {
    if (question.questionType === QuestionType.MULTIPLE_CHOICE) {
      if (
        !answer.selectedOptionId ||
        answer.booleanAnswer !== undefined ||
        answer.textAnswer !== undefined
      ) {
        throw new Error('A multiple-choice answer is an option id');
      }
      return answer.selectedOptionId;
    }
    if (question.questionType === QuestionType.TRUE_FALSE) {
      if (
        answer.booleanAnswer === undefined ||
        answer.selectedOptionId !== undefined ||
        answer.textAnswer !== undefined
      ) {
        throw new Error('A true/false answer is true or false');
      }
      return answer.booleanAnswer;
    }
    if (
      !answer.textAnswer ||
      answer.selectedOptionId !== undefined ||
      answer.booleanAnswer !== undefined
    ) {
      throw new Error('A short answer must be text');
    }
    return answer.textAnswer;
  }

  private present(assessment: AssessmentRecord, reveal: boolean): AssessmentResponseDto {
    return {
      ...assessment,
      questions: assessment.questions.map((question) => this.presentQuestion(question, reveal)),
    };
  }

  private presentQuestion(question: QuestionRecord, reveal: boolean): QuestionResponseDto {
    const base: QuestionResponseDto = {
      id: question.id,
      text: question.text,
      questionType: question.questionType,
      options: this.optionsOf(question.options),
      marks: question.marks,
      displayOrder: question.displayOrder,
    };
    if (!reveal) return base;
    return {
      ...base,
      correctAnswer: question.correctAnswer ?? null,
      explanation: question.explanation,
    };
  }

  private presentAttempt(
    attempt: {
      id: string;
      assessmentId: string;
      userId: string;
      attemptNumber: number;
      status: AttemptStatus;
      score: number | null;
      maxScore: number | null;
      percentage: number | null;
      passed: boolean | null;
      timedOut: boolean;
      startedAt: Date;
      submittedAt: Date | null;
    },
    answers: {
      questionId: string;
      response: Prisma.JsonValue;
      awardedMarks: number | null;
      question: QuestionRecord;
    }[],
    reveal = false,
  ): AttemptResponseDto {
    return {
      id: attempt.id,
      assessmentId: attempt.assessmentId,
      userId: attempt.userId,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      passed: attempt.passed,
      timedOut: attempt.timedOut,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      answers: [...answers]
        .sort((left, right) => left.question.displayOrder - right.question.displayOrder)
        .map((answer) => ({
          questionId: answer.questionId,
          response: answer.response,
          awardedMarks: answer.awardedMarks,
          ...(reveal
            ? {
                correctAnswer: answer.question.correctAnswer ?? null,
                explanation: answer.question.explanation,
              }
            : {}),
        })),
    };
  }

  private optionsOf(value: Prisma.JsonValue): { id: string; text: string }[] | null {
    if (!Array.isArray(value)) return null;
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as { id?: unknown; text?: unknown };
      return typeof record.id === 'string' && typeof record.text === 'string'
        ? [{ id: record.id, text: record.text }]
        : [];
    });
  }

  private timedOut(limitMinutes: number | null, startedAt: Date, submittedAt: Date): boolean {
    if (!limitMinutes) return false;
    return submittedAt.getTime() - startedAt.getTime() > limitMinutes * 60 * 1000;
  }

  private oneParent(dto: { courseId?: string; moduleId?: string; lessonId?: string }): {
    courseId: string | null;
    moduleId: string | null;
    lessonId: string | null;
  } {
    const chosen = [dto.courseId, dto.moduleId, dto.lessonId].filter(
      (value) => value !== undefined,
    );
    if (chosen.length !== 1) {
      throw new BadRequestException(
        'An assessment belongs to exactly one course, module, or lesson',
      );
    }
    return {
      courseId: dto.courseId ?? null,
      moduleId: dto.moduleId ?? null,
      lessonId: dto.lessonId ?? null,
    };
  }

  private async assertParentExists(parent: {
    courseId: string | null;
    moduleId: string | null;
    lessonId: string | null;
  }): Promise<void> {
    if (parent.courseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: parent.courseId },
        select: { id: true },
      });
      if (!course) throw new NotFoundException('Course not found');
    }
    if (parent.moduleId) {
      const module = await this.prisma.courseModule.findUnique({
        where: { id: parent.moduleId },
        select: { id: true },
      });
      if (!module) throw new NotFoundException('Module not found');
    }
    if (parent.lessonId) {
      const lesson = await this.prisma.lesson.findUnique({
        where: { id: parent.lessonId },
        select: { id: true },
      });
      if (!lesson) throw new NotFoundException('Lesson not found');
    }
  }

  private async load(id: string): Promise<AssessmentRecord> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
      select: assessmentSelect,
    });
    if (!assessment) throw new NotFoundException('Assessment not found');
    return assessment;
  }

  private async courseIdOf(assessment: {
    courseId: string | null;
    moduleId: string | null;
    lessonId: string | null;
  }): Promise<string> {
    if (assessment.courseId) return assessment.courseId;
    if (assessment.moduleId) {
      const module = await this.prisma.courseModule.findUnique({
        where: { id: assessment.moduleId },
        select: { courseId: true },
      });
      if (!module) throw new NotFoundException('Module not found');
      return module.courseId;
    }
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: assessment.lessonId ?? '' },
      select: { module: { select: { courseId: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    return lesson.module.courseId;
  }

  private async courseIdFromQuery(query: ListAssessmentsQueryDto): Promise<string> {
    return this.courseIdOf({
      courseId: query.courseId ?? null,
      moduleId: query.moduleId ?? null,
      lessonId: query.lessonId ?? null,
    });
  }

  private async assertCanSeeCourse(courseId: string, actor: AuthenticatedUser): Promise<void> {
    if (isAdmin(actor) || actor.roles.includes(RoleCode.Facilitator)) {
      await this.courses.findOne(courseId, actor);
      return;
    }
    try {
      await this.courses.findOne(courseId, actor);
      return;
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    const state = await this.enrollments.studyState(actor.id, courseId);
    if (state === 'none') throw new NotFoundException('Course not found');
  }

  private async assertMayAttempt(userId: string, courseId: string): Promise<void> {
    const state = await this.enrollments.studyState(userId, courseId);
    if (state !== 'ok')
      throw new ForbiddenException('An active or completed enrollment is required');
  }

  private canReview(actor: AuthenticatedUser): boolean {
    return isAdmin(actor) || actor.roles.includes(RoleCode.Facilitator);
  }

  private async canReviewUser(actor: AuthenticatedUser, userId: string): Promise<boolean> {
    if (isAdmin(actor)) return true;
    if (!actor.roles.includes(RoleCode.Facilitator)) return false;
    const membership = await this.prisma.facilitatorGroupMember.findFirst({
      where: { userId, group: { facilitatorId: actor.id, status: RecordStatus.ACTIVE } },
      select: { userId: true },
    });
    return membership !== null;
  }

  private async canReadAttempt(actor: AuthenticatedUser, userId: string): Promise<boolean> {
    if (actor.id === userId) return true;
    return this.canReviewUser(actor, userId);
  }

  private async attemptWhere(
    query: ListAttemptsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Prisma.AssessmentAttemptWhereInput> {
    const where: Prisma.AssessmentAttemptWhereInput = {};
    if (query.assessmentId) where.assessmentId = query.assessmentId;
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

  private async nextOrder(assessmentId: string): Promise<number> {
    const max = await this.prisma.assessmentQuestion.aggregate({
      where: { assessmentId },
      _max: { displayOrder: true },
    });
    return (max._max.displayOrder ?? -1) + 1;
  }
}
