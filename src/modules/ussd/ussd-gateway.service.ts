import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LearningChannel,
  TelephonyEndReason,
  TelephonySessionStatus,
} from '../../generated/prisma/client';
import { FarmerIdentityService } from '../telephony/farmer-identity.service';
import { TelephonyLearningService } from '../telephony/telephony-learning.service';
import { TelephonySettingsService } from '../telephony/telephony-settings.service';
import { TELEPHONY_CHANNEL } from '../telephony/telephony.constants';
import type { UssdGatewayAdapter, UssdGatewayResponse } from './gateway/ussd-gateway.interfaces';
import { UssdGatewayRegistry } from './gateway/ussd-gateway.registry';
import { handleMenuInput, initialState } from './menus/ussd-menu.engine';
import { UssdSessionService } from './ussd-session.service';

@Injectable()
export class UssdGatewayService {
  constructor(
    private readonly registry: UssdGatewayRegistry,
    private readonly sessions: UssdSessionService,
    private readonly farmers: FarmerIdentityService,
    private readonly learning: TelephonyLearningService,
    private readonly settings: TelephonySettingsService,
    private readonly config: ConfigService,
  ) {}

  async handleCallback(
    providerId: string | undefined,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<{ formatted: unknown; providerId: string }> {
    const adapter = this.registry.resolve(providerId);
    const secret = this.config.get<string>('ussd.callbackSecret', { infer: true }) ?? '';
    if (!secret || !adapter.verify({ headers, body }, secret)) {
      throw new UnauthorizedException('Invalid USSD callback signature');
    }

    const channel = await this.settings.get(TELEPHONY_CHANNEL.Ussd);
    if (!channel.isEnabled) {
      const response: UssdGatewayResponse = {
        message: 'USSD learning is not enabled.',
        continueSession: false,
      };
      return { formatted: adapter.format(response), providerId: adapter.id };
    }

    const request = adapter.parse(body);
    if (
      !request.providerSessionId ||
      request.providerSessionId.length > 128 ||
      !request.phoneNumber ||
      request.phoneNumber.length > 32 ||
      request.text.length > 1024 ||
      (request.requestId !== undefined && (!request.requestId || request.requestId.length > 128))
    ) {
      throw new BadRequestException('Invalid normalized USSD callback payload');
    }
    const inputHash = request.requestId
      ? this.sessions.hashInput(adapter.id, request.providerSessionId, request.requestId)
      : undefined;
    let session = await this.sessions.findActive(adapter.id, request.providerSessionId);
    const farmer = await this.farmers.tryResolveByPhone(request.phoneNumber);
    if (
      session &&
      (!farmer || session.userId !== farmer.actor.id || session.phoneNumber !== farmer.phoneNumber)
    ) {
      if (session.learningSessionId && farmer) {
        await this.learning.closeLessonSession(session.learningSessionId, farmer.actor, false);
      }
      await this.sessions.end(session.id, TelephonyEndReason.ERROR);
      throw new ForbiddenException('USSD session identity does not match');
    }

    if (session && this.sessions.isExpired(session, channel.sessionTtlSeconds)) {
      if (farmer && session.learningSessionId) {
        await this.learning.closeLessonSession(session.learningSessionId, farmer.actor, false);
      }
      await this.sessions.end(
        session.id,
        TelephonyEndReason.TIMEOUT,
        TelephonySessionStatus.EXPIRED,
      );
      const response: UssdGatewayResponse = {
        message: 'Session expired. Start a new session.',
        continueSession: false,
      };
      return { formatted: adapter.format(response), providerId: adapter.id };
    }

    if (!farmer) {
      const response: UssdGatewayResponse = {
        message: 'No active registered farmer was found for this number.',
        continueSession: false,
      };
      return { formatted: adapter.format(response), providerId: adapter.id };
    }

    if (session && this.sessions.isDuplicate(session, inputHash)) {
      const response: UssdGatewayResponse = {
        message: 'Request already processed. Continue with the next menu selection.',
        continueSession: true,
      };
      return { formatted: adapter.format(response), providerId: adapter.id };
    }

    if (!session && request.isNewSession) {
      session = await this.sessions.create({
        providerId: adapter.id,
        providerSessionId: request.providerSessionId,
        phoneNumber: farmer.phoneNumber,
        userId: farmer.actor.id,
        language: farmer.preferredLanguage,
        state: initialState(farmer.preferredLanguage),
        isTestData: Boolean(adapter.isTestDouble),
        ttlSeconds: channel.sessionTtlSeconds,
      });
    } else if (!session) {
      throw new NotFoundException('USSD session not found');
    }

    const state = this.sessions.parseState(session);
    const courses = await this.learning.listCourses(farmer.actor);
    const progressSummary = await this.learning.progressSummary(farmer.actor, state.language);
    const assessments =
      state.courseId && (state.menuCode === 'MAIN' || state.menuCode === 'ASSESSMENT_LIST')
        ? await this.learning.listAssessments(state.courseId, farmer.actor)
        : [];
    const continuation =
      state.menuCode === 'MAIN' && request.text.trim() === '3'
        ? await this.learning.continueLearning(farmer.actor)
        : undefined;
    const input = request.text.trim().split('*').at(-1) ?? '';
    const selectedCourse =
      (state.menuCode === 'COURSE_LIST' || state.menuCode === 'MY_COURSES') && input
        ? (state.menuCode === 'MY_COURSES'
            ? courses.filter((course) => course.activeEnrollment)
            : courses)[(state.coursePage ?? 0) * 8 + Number.parseInt(input, 10) - 1]
        : undefined;
    const selectedModule =
      state.menuCode === 'MODULE_LIST' && input
        ? (state.moduleOptions ?? [])[(state.modulePage ?? 0) * 8 + Number.parseInt(input, 10) - 1]
        : undefined;
    const modules =
      selectedCourse?.activeEnrollment || selectedCourse?.completedEnrollment
        ? await this.learning.listModules(selectedCourse.id, farmer.actor)
        : state.courseId
          ? await this.learning.listModules(state.courseId, farmer.actor)
          : [];
    const moduleId = selectedModule?.id ?? state.moduleId;
    const lessons = moduleId ? await this.learning.listLessons(moduleId, farmer.actor) : [];
    const selectedLesson =
      state.menuCode === 'LESSON_LIST' && input
        ? lessons[(state.lessonPageNumber ?? 0) * 8 + Number.parseInt(input, 10) - 1]
        : undefined;
    const requestedLessonId =
      selectedLesson?.id ??
      (state.menuCode === 'LESSON_CONTENT' && input === '9'
        ? state.lessonId
        : state.menuCode === 'LESSON_CONTENT' || continuation
          ? (state.lessonId ?? continuation?.lessonId)
          : undefined);

    let lessonPage: { title: string; body: string; page: number; total: number } | undefined;
    if (requestedLessonId) {
      const requestedPage =
        state.menuCode === 'LESSON_CONTENT' && input === '9'
          ? (state.contentPage ?? 1) + 1
          : state.menuCode === 'LESSON_CONTENT'
            ? (state.contentPage ?? 1)
            : 1;
      lessonPage = await this.learning.lessonContentPage(
        requestedLessonId,
        requestedPage,
        channel.maxScreenChars,
        farmer.actor,
      );
    }

    const step = handleMenuInput(state, request.text, {
      maxChars: channel.maxScreenChars,
      courses,
      modules,
      lessons,
      assessments,
      progressSummary,
      lessonPage,
      continuation: continuation ?? undefined,
    });

    let learningSessionId = session.learningSessionId;
    if (step.action?.type === 'enroll') {
      await this.learning.enroll(step.action.courseId, farmer.actor);
    } else if (step.action?.type === 'start-lesson') {
      learningSessionId = await this.learning.startLesson(
        step.action.lessonId,
        LearningChannel.USSD,
        farmer.actor,
      );
      step.state.learningSessionId = learningSessionId;
    } else if (step.action?.type === 'complete-lesson') {
      await this.learning.markLessonComplete(
        step.action.lessonId,
        LearningChannel.USSD,
        farmer.actor,
      );
      await this.learning.closeLessonSession(
        step.action.learningSessionId ?? learningSessionId,
        farmer.actor,
        true,
      );
      learningSessionId = null;
    } else if (step.action?.type === 'start-assessment') {
      const attempt = await this.learning.startAssessment(step.action.assessmentId, farmer.actor);
      step.state.assessmentAttemptId = attempt.id;
    } else if (step.action?.type === 'submit-assessment') {
      const attempt = await this.learning.submitAssessmentAttempt(
        step.action.attemptId,
        { answers: step.action.answers },
        farmer.actor,
      );
      step.message = this.formatAssessmentResult(attempt, state.language, channel.maxScreenChars);
    } else if (
      state.menuCode === 'LESSON_CONTENT' &&
      step.state.menuCode === 'MAIN' &&
      learningSessionId
    ) {
      await this.learning.closeLessonSession(learningSessionId, farmer.actor, false);
      learningSessionId = null;
    }

    if (!step.continueSession || step.userExit) {
      await this.learning.closeLessonSession(learningSessionId, farmer.actor, false);
      await this.sessions.end(
        session.id,
        step.userExit ? TelephonyEndReason.USER_EXIT : TelephonyEndReason.PROVIDER_END,
      );
    } else {
      await this.sessions.touch(session, {
        menuCode: step.menuCode,
        state: step.state,
        inputHash,
        ttlSeconds: channel.sessionTtlSeconds,
        learningSessionId,
      });
    }

    const response: UssdGatewayResponse = {
      message: step.message,
      continueSession: step.continueSession,
    };
    return { formatted: adapter.format(response), providerId: adapter.id };
  }

  private formatAssessmentResult(
    attempt: Awaited<ReturnType<TelephonyLearningService['submitAssessmentAttempt']>>,
    language: 'rw' | 'en',
    maxChars: number,
  ): string {
    const outcome =
      attempt.passed === true
        ? language === 'rw'
          ? 'Watsinze.'
          : 'You passed.'
        : attempt.passed === false
          ? language === 'rw'
            ? 'Ntabwo watsinze.'
            : 'You did not pass.'
          : language === 'rw'
            ? 'Isuzuma rikeneye gusuzumwa.'
            : 'Your assessment needs review.';
    const score = attempt.percentage === null ? '' : ` ${attempt.percentage}%`;
    const characters = Array.from(`${outcome}${score}`);
    return characters.length <= maxChars
      ? characters.join('')
      : characters.slice(0, maxChars).join('');
  }
}
