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
import type { IvrGatewayResponse } from './gateway/ivr-gateway.interfaces';
import { IvrGatewayRegistry } from './gateway/ivr-gateway.registry';
import { handleIvrInput, initialIvrState } from './menus/ivr-menu.engine';
import { IvrAudioService } from './ivr-audio.service';
import { IvrSessionService } from './ivr-session.service';

const MENU_PAGE_SIZE = 8;

@Injectable()
export class IvrGatewayService {
  constructor(
    private readonly registry: IvrGatewayRegistry,
    private readonly sessions: IvrSessionService,
    private readonly farmers: FarmerIdentityService,
    private readonly learning: TelephonyLearningService,
    private readonly settings: TelephonySettingsService,
    private readonly audio: IvrAudioService,
    private readonly config: ConfigService,
  ) {}

  async handleCallback(
    providerId: string | undefined,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<unknown> {
    const adapter = this.registry.resolve(providerId);
    const secret = this.config.get<string>('ivr.callbackSecret', { infer: true }) ?? '';
    if (!secret || !adapter.verify({ headers, body }, secret)) {
      throw new UnauthorizedException('Invalid IVR callback signature');
    }

    const channel = await this.settings.get(TELEPHONY_CHANNEL.Ivr);
    if (!channel.isEnabled) {
      return adapter.format({
        message: 'IVR learning is not enabled.',
        continueSession: false,
        audioUnavailable: true,
      });
    }

    const request = adapter.parse(body);
    if (
      !request.providerSessionId ||
      request.providerSessionId.length > 128 ||
      !request.phoneNumber ||
      request.phoneNumber.length > 32 ||
      request.digits.length > 128 ||
      !/^[0-9*#]*$/.test(request.digits) ||
      (request.requestId !== undefined && (!request.requestId || request.requestId.length > 128))
    ) {
      throw new BadRequestException('Invalid normalized IVR callback payload');
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
      throw new ForbiddenException('IVR session identity does not match');
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
      return adapter.format({
        message: 'Session expired. Start a new call.',
        continueSession: false,
        audioUnavailable: !this.audio.hasProvider,
      });
    }
    if (!farmer) {
      return adapter.format({
        message: 'No active registered farmer was found for this number.',
        continueSession: false,
        audioUnavailable: !this.audio.hasProvider,
      });
    }

    if (session && this.sessions.isDuplicate(session, inputHash)) {
      return adapter.format({
        message: 'Request already processed. Continue with the next menu selection.',
        continueSession: true,
        audioUnavailable: !this.audio.hasProvider,
      });
    }

    if (!session && request.isNewSession) {
      session = await this.sessions.create({
        providerId: adapter.id,
        providerSessionId: request.providerSessionId,
        callSid: request.callSid,
        phoneNumber: farmer.phoneNumber,
        userId: farmer.actor.id,
        language: farmer.preferredLanguage,
        state: initialIvrState(farmer.preferredLanguage),
        isTestData: Boolean(adapter.isTestDouble),
        ttlSeconds: channel.sessionTtlSeconds,
      });
    } else if (!session) {
      throw new NotFoundException('IVR session not found');
    }

    const state = this.sessions.parseState(session);
    const courses = await this.learning.listCourses(farmer.actor);
    const progressSummary = await this.learning.progressSummary(farmer.actor, state.language);
    const continuation =
      state.menuCode === 'MAIN' && request.digits.trim() === '3'
        ? await this.learning.continueLearning(farmer.actor)
        : undefined;
    const input = request.digits.trim().slice(-1);
    const selectedCourse =
      (state.menuCode === 'COURSE_LIST' || state.menuCode === 'MY_COURSES') && input
        ? (state.menuCode === 'MY_COURSES'
            ? courses.filter((course) => course.activeEnrollment || course.completedEnrollment)
            : courses)[(state.coursePage ?? 0) * MENU_PAGE_SIZE + Number.parseInt(input, 10) - 1]
        : undefined;
    const selectedModule =
      state.menuCode === 'MODULE_LIST' && input
        ? (state.moduleOptions ?? [])[
            (state.modulePage ?? 0) * MENU_PAGE_SIZE + Number.parseInt(input, 10) - 1
          ]
        : undefined;
    const modules = selectedCourse?.activeEnrollment || selectedCourse?.completedEnrollment
      ? await this.learning.listModules(selectedCourse.id, farmer.actor)
      : state.courseId
        ? await this.learning.listModules(state.courseId, farmer.actor)
        : [];
    const moduleId = selectedModule?.id ?? state.moduleId;
    const lessons = moduleId ? await this.learning.listLessons(moduleId, farmer.actor) : [];

    const step = handleIvrInput(state, request.digits, {
      courses,
      modules,
      lessons,
      continuation: continuation ?? undefined,
      progressSummary,
      audioAvailable: this.audio.hasProvider,
    });

    let learningSessionId = session.learningSessionId;
    let audioCommand: IvrGatewayResponse['audioCommand'];
    if (step.action?.type === 'enroll') {
      await this.learning.enroll(step.action.courseId, farmer.actor);
    } else if (step.action?.type === 'play-lesson') {
      audioCommand = await this.audio.buildLessonCommand(step.action.lessonId, step.state.language);
      if (audioCommand.kind !== 'unavailable' && !step.state.courseCompleted) {
        learningSessionId = await this.learning.startLesson(
          step.action.lessonId,
          LearningChannel.IVR,
          farmer.actor,
        );
        step.state.learningSessionId = learningSessionId;
      } else {
        step.message = audioCommand.message ?? step.message;
      }
    } else if (step.action?.type === 'complete-lesson') {
      await this.learning.markLessonComplete(
        step.action.lessonId,
        LearningChannel.IVR,
        farmer.actor,
      );
      await this.learning.closeLessonSession(
        step.action.learningSessionId ?? learningSessionId,
        farmer.actor,
        true,
      );
      learningSessionId = null;
    } else if (state.menuCode === 'LESSON' && step.state.menuCode === 'MAIN' && learningSessionId) {
      await this.learning.closeLessonSession(learningSessionId, farmer.actor, false);
      learningSessionId = null;
    }

    if (!step.continueSession) {
      await this.learning.closeLessonSession(learningSessionId, farmer.actor, false);
      await this.sessions.end(session.id, TelephonyEndReason.USER_EXIT);
    } else {
      await this.sessions.touch(session, {
        menuCode: step.state.menuCode,
        state: step.state,
        inputHash,
        ttlSeconds: channel.sessionTtlSeconds,
        learningSessionId,
      });
    }

    const response: IvrGatewayResponse = {
      message: audioCommand?.message ?? step.message,
      continueSession: step.continueSession,
      audioUnavailable: audioCommand?.kind === 'unavailable' || !this.audio.hasProvider,
      audioCommand,
    };
    return adapter.format(response);
  }
}
