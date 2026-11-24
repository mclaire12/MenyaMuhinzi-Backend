import type { Language } from '../../../generated/prisma/client';
import type {
  TelephonyAssessmentOption,
  TelephonyCourseOption,
  TelephonyLessonOption,
  TelephonyModuleOption,
} from '../../telephony/telephony-learning.service';
import type { SubmitAnswerDto } from '../../assessments/dto/assessment.dto';
import { menuLines, type UssdMenuCode } from './ussd-menu.catalog';

export interface UssdSessionState {
  language: Language;
  menuCode: UssdMenuCode;
  courseId?: string;
  courseCompleted?: boolean;
  moduleId?: string;
  lessonId?: string;
  learningSessionId?: string;
  assessmentId?: string;
  assessmentAttemptId?: string;
  assessmentQuestionIndex?: number;
  assessmentAnswers?: SubmitAnswerDto[];
  contentPage?: number;
  coursePage?: number;
  modulePage?: number;
  lessonPageNumber?: number;
  assessmentPage?: number;
  courseOptions?: TelephonyCourseOption[];
  moduleOptions?: TelephonyModuleOption[];
  lessonOptions?: TelephonyLessonOption[];
  assessmentOptions?: TelephonyAssessmentOption[];
  assessmentQuestions?: TelephonyAssessmentOption['questions'];
}

export type UssdMenuAction =
  | { type: 'enroll'; courseId: string }
  | { type: 'start-lesson'; lessonId: string }
  | { type: 'complete-lesson'; lessonId: string; learningSessionId?: string }
  | { type: 'start-assessment'; assessmentId: string }
  | { type: 'submit-assessment'; attemptId: string; answers: SubmitAnswerDto[] };

export interface UssdMenuStep {
  menuCode: UssdMenuCode;
  state: UssdSessionState;
  message: string;
  continueSession: boolean;
  userExit?: boolean;
  action?: UssdMenuAction;
}

export interface UssdMenuContext {
  maxChars: number;
  courses: TelephonyCourseOption[];
  modules?: TelephonyModuleOption[];
  lessons?: TelephonyLessonOption[];
  assessments?: TelephonyAssessmentOption[];
  progressSummary: string;
  lessonPage?: { title: string; body: string; page: number; total: number };
  continuation?: { courseId: string; lessonId: string };
  blockedMessage?: string;
}

const PAGE_SIZE = 8;

export function initialState(language: Language): UssdSessionState {
  return { language, menuCode: 'MAIN' };
}

export function handleMenuInput(
  state: UssdSessionState,
  input: string,
  context: UssdMenuContext,
): UssdMenuStep {
  const trimmed = input.trim().split('*').at(-1) ?? '';
  if (context.blockedMessage) {
    return step('BLOCKED', state, context.blockedMessage, context, false);
  }

  if (state.menuCode === 'MAIN') {
    if (!trimmed) return step('MAIN', state, undefined, context);
    if (trimmed === '0') return exitStep(state, context.maxChars);
    if (trimmed === '1') {
      return listStep('COURSE_LIST', { ...state, coursePage: 0 }, context.courses, context);
    }
    if (trimmed === '2') {
      return listStep(
        'MY_COURSES',
        { ...state, coursePage: 0 },
        context.courses.filter((course) => course.activeEnrollment || course.completedEnrollment),
        context,
      );
    }
    if (trimmed === '3') {
      if (!context.continuation) {
        return step(
          'MAIN',
          state,
          state.language === 'rw' ? 'Nta somo ryo gukomeza.' : 'No lesson to continue.',
          context,
        );
      }
      const nextState = {
        ...state,
        menuCode: 'LESSON_CONTENT' as const,
        courseId: context.continuation.courseId,
        lessonId: context.continuation.lessonId,
        contentPage: 1,
      };
      return lessonStep(nextState, context, { type: 'start-lesson', lessonId: nextState.lessonId });
    }
    if (trimmed === '4') return step('PROGRESS', state, context.progressSummary, context);
    if (trimmed === '5') return step('LANGUAGE', state, undefined, context);
    if (trimmed === '6') {
      return step(
        'HELP',
        state,
        state.language === 'rw'
          ? 'Hamagara umufashamyumvire wawe kugira ngo agufashe.'
          : 'Contact your facilitator for help.',
        context,
      );
    }
    if (trimmed === '7') {
      if (!state.courseId) {
        return step(
          'MAIN',
          state,
          state.language === 'rw'
            ? 'Banza uhitemo isomo ukoresheje 1.'
            : 'Select a course first using 1.',
          context,
        );
      }
      const assessments = context.assessments ?? [];
      return listStep(
        'ASSESSMENT_LIST',
        { ...state, assessmentPage: 0, assessmentOptions: assessments },
        assessments,
        context,
      );
    }
    return invalid(state, context);
  }

  if (state.menuCode === 'LANGUAGE') {
    if (trimmed === '1') return step('MAIN', { ...state, language: 'rw' }, undefined, context);
    if (trimmed === '2') return step('MAIN', { ...state, language: 'en' }, undefined, context);
    if (trimmed === '0') return step('MAIN', state, undefined, context);
    return invalid(state, context);
  }

  if (state.menuCode === 'COURSE_LIST' || state.menuCode === 'MY_COURSES') {
    const options =
      state.menuCode === 'MY_COURSES'
        ? context.courses.filter((course) => course.activeEnrollment || course.completedEnrollment)
        : context.courses;
    return selectFromList(state, trimmed, options, 'coursePage', context, (selected) => {
      const next = {
        ...state,
        courseId: selected.id,
        courseCompleted: selected.completedEnrollment,
        modulePage: 0,
        moduleOptions: context.modules ?? [],
      };
      if (selected.activeEnrollment || selected.completedEnrollment) {
        return listStep('MODULE_LIST', next, context.modules ?? [], context);
      }
      return step(
        'COURSE_CONFIRM',
        next,
        state.language === 'rw'
          ? `${selected.title}. Kanda 1 kugira ngo wiyandikishe.`
          : `${selected.title}. Press 1 to enroll.`,
        context,
      );
    });
  }

  if (state.menuCode === 'COURSE_CONFIRM') {
    if (trimmed === '0') return step('MAIN', state, undefined, context);
    if (trimmed !== '1' || !state.courseId) return invalid(state, context);
    const next = { ...state, modulePage: 0, moduleOptions: context.modules ?? [] };
    return {
      ...listStep('MODULE_LIST', next, context.modules ?? [], context),
      action: { type: 'enroll', courseId: state.courseId },
    };
  }

  if (state.menuCode === 'MODULE_LIST') {
    return selectFromList(
      state,
      trimmed,
      state.moduleOptions ?? [],
      'modulePage',
      context,
      (selected) =>
        listStep(
          'LESSON_LIST',
          {
            ...state,
            moduleId: selected.id,
            lessonPageNumber: 0,
            lessonOptions: context.lessons ?? [],
          },
          context.lessons ?? [],
          context,
        ),
    );
  }

  if (state.menuCode === 'LESSON_LIST') {
    return selectFromList(
      state,
      trimmed,
      state.lessonOptions ?? [],
      'lessonPageNumber',
      context,
      (selected) => {
        const next = { ...state, lessonId: selected.id, contentPage: 1 };
        if (!context.lessonPage) {
          return step(
            'LESSON_CONTENT',
            next,
            state.language === 'rw'
              ? `${selected.title}. Kanda 1 kugira ngo utangire.`
              : `${selected.title}. Press 1 to start.`,
            context,
          );
        }
        return lessonStep(
          next,
          context,
          state.courseCompleted ? undefined : { type: 'start-lesson', lessonId: selected.id },
        );
      },
    );
  }

  if (state.menuCode === 'LESSON_CONTENT') {
    if (trimmed === '0') return step('MAIN', state, undefined, context);
    if (
      trimmed === '9' &&
      context.lessonPage &&
      (state.contentPage ?? 1) < context.lessonPage.total
    ) {
      return lessonStep({ ...state, contentPage: (state.contentPage ?? 1) + 1 }, context);
    }
    if (trimmed === '8' && state.lessonId) {
      const completed: UssdMenuStep = {
        menuCode: 'MAIN',
        state: { language: state.language, menuCode: 'MAIN', courseId: state.courseId },
        message: state.courseCompleted
          ? state.language === 'rw'
            ? 'Iri somo ryararangiye. 0=Menu'
            : 'This lesson is already completed. 0=Menu'
          : state.language === 'rw'
            ? 'Isomo rirangiye. 1=Kwiga 2=Amasomo yanjye 0=Gusohoka'
            : 'Lesson completed. 1=Learn 2=My courses 0=Exit',
        continueSession: true,
      };
      completed.message = truncate(completed.message, context.maxChars);
      return {
        ...completed,
        action: state.courseCompleted
          ? undefined
          : {
              type: 'complete-lesson',
              lessonId: state.lessonId,
              learningSessionId: state.learningSessionId,
            },
      };
    }
    if (trimmed === '1' && state.lessonId && !state.learningSessionId && !state.courseCompleted) {
      return lessonStep(state, context, { type: 'start-lesson', lessonId: state.lessonId });
    }
    if (!trimmed && context.lessonPage) return lessonStep(state, context);
    return invalid(state, context);
  }

  if (state.menuCode === 'PROGRESS' || state.menuCode === 'HELP') {
    if (trimmed === '0') return step('MAIN', state, undefined, context);
    return invalid(state, context);
  }

  if (state.menuCode === 'ASSESSMENT_LIST') {
    return selectFromList(
      state,
      trimmed,
      context.assessments ?? state.assessmentOptions ?? [],
      'assessmentPage',
      context,
      (assessment) =>
        questionStep(
          {
            ...state,
            menuCode: 'ASSESSMENT_QUESTION',
            assessmentId: assessment.id,
            assessmentQuestionIndex: 0,
            assessmentAnswers: [],
            assessmentQuestions: assessment.questions,
          },
          context,
          { type: 'start-assessment', assessmentId: assessment.id },
        ),
    );
  }

  if (state.menuCode === 'ASSESSMENT_QUESTION') {
    const questions = state.assessmentQuestions ?? [];
    const questionIndex = state.assessmentQuestionIndex ?? 0;
    const question = questions[questionIndex];
    if (!question || !state.assessmentAttemptId) return invalid(state, context);
    const choice = /^[1-9]$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    let answer: SubmitAnswerDto;
    if (question.questionType === 'TRUE_FALSE' && (choice === 1 || choice === 2)) {
      answer = { questionId: question.id, booleanAnswer: choice === 1 };
    } else if (question.questionType === 'MULTIPLE_CHOICE' && question.options[choice - 1]) {
      answer = {
        questionId: question.id,
        selectedOptionId: question.options[choice - 1].id,
      };
    } else {
      return invalid(state, context);
    }

    const answers = [...(state.assessmentAnswers ?? []), answer];
    if (questionIndex + 1 < questions.length) {
      return questionStep(
        { ...state, assessmentAnswers: answers, assessmentQuestionIndex: questionIndex + 1 },
        context,
      );
    }
    return {
      ...step(
        'MAIN',
        { language: state.language, menuCode: 'MAIN', courseId: state.courseId },
        state.language === 'rw' ? 'Isuzuma ririmo koherezwa...' : 'Submitting assessment...',
        context,
      ),
      action: {
        type: 'submit-assessment',
        attemptId: state.assessmentAttemptId,
        answers,
      },
    };
  }

  return invalid(state, context);
}

function selectFromList<
  T extends
    | TelephonyCourseOption
    | TelephonyModuleOption
    | TelephonyLessonOption
    | TelephonyAssessmentOption,
>(
  state: UssdSessionState,
  input: string,
  options: T[],
  pageProperty: 'coursePage' | 'modulePage' | 'lessonPageNumber' | 'assessmentPage',
  context: UssdMenuContext,
  onSelect: (selected: T) => UssdMenuStep,
): UssdMenuStep {
  const page = state[pageProperty] ?? 0;
  const selection = /^[1-9]$/.test(input) ? Number(input) : Number.NaN;
  if (input === '9' && (page + 1) * PAGE_SIZE < options.length) {
    return listStep(state.menuCode, { ...state, [pageProperty]: page + 1 }, options, context);
  }
  if (input === '0') return step('MAIN', state, undefined, context);
  const selected = options[page * PAGE_SIZE + selection - 1];
  if (!Number.isInteger(selection) || selection < 1 || selection > PAGE_SIZE || !selected) {
    return invalid(state, context);
  }
  return onSelect(selected);
}

function listStep(
  code: UssdMenuCode,
  state: UssdSessionState,
  options: Array<
    | TelephonyCourseOption
    | TelephonyModuleOption
    | TelephonyLessonOption
    | TelephonyAssessmentOption
  >,
  context: UssdMenuContext,
): UssdMenuStep {
  const pageProperty =
    code === 'COURSE_LIST' || code === 'MY_COURSES'
      ? 'coursePage'
      : code === 'MODULE_LIST'
        ? 'modulePage'
        : code === 'LESSON_LIST'
          ? 'lessonPageNumber'
          : 'assessmentPage';
  const page = state[pageProperty] ?? 0;
  const entries = options.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const extra = entries.map((option, index) => `${index + 1}. ${option.title}`);
  if (options.length === 0) {
    extra.push(state.language === 'rw' ? 'Nta bintu bihari.' : 'Nothing is available yet.');
  }
  if ((page + 1) * PAGE_SIZE < options.length) {
    extra.push(state.language === 'rw' ? '9. Ibikurikira' : '9. More');
  }
  return step(code, state, extra.join('\n'), context);
}

function questionStep(
  state: UssdSessionState,
  context: UssdMenuContext,
  action?: UssdMenuAction,
): UssdMenuStep {
  const question = state.assessmentQuestions?.[state.assessmentQuestionIndex ?? 0];
  if (!question) return step('MAIN', state, undefined, context);
  const options =
    question.questionType === 'MULTIPLE_CHOICE'
      ? question.options.map((option, index) => `${index + 1}. ${option.text}`)
      : state.language === 'rw'
        ? ['1. Yego', '2. Oya']
        : ['1. True', '2. False'];
  return {
    ...step('ASSESSMENT_QUESTION', state, `${question.text}\n${options.join('\n')}`, context),
    action,
  };
}

function lessonStep(
  state: UssdSessionState,
  context: UssdMenuContext,
  action?: UssdMenuAction,
): UssdMenuStep {
  if (!context.lessonPage) {
    return step(
      'LESSON_CONTENT',
      state,
      state.language === 'rw'
        ? 'Tegereza isomo rishobora kuboneka.'
        : 'Lesson content is unavailable.',
      context,
    );
  }
  const footer =
    state.language === 'rw'
      ? `Paji ${context.lessonPage.page}/${context.lessonPage.total}. 9=Komeza 8=Rangiza 0=Menu`
      : `Page ${context.lessonPage.page}/${context.lessonPage.total}. 9=Next 8=Done 0=Menu`;
  return step(
    'LESSON_CONTENT',
    state,
    `${context.lessonPage.title}\n${context.lessonPage.body}\n${footer}`,
    context,
    true,
    action,
  );
}

function step(
  menuCode: UssdMenuCode,
  state: UssdSessionState,
  extra: string | undefined,
  context: UssdMenuContext,
  continueSession = true,
  action?: UssdMenuAction,
): UssdMenuStep {
  const content = extra ? [extra] : undefined;
  return {
    menuCode,
    state: { ...state, menuCode },
    message: truncate(menuLines(menuCode, state.language, content).join('\n'), context.maxChars),
    continueSession,
    action,
  };
}

function invalid(state: UssdSessionState, context: UssdMenuContext): UssdMenuStep {
  return step(
    state.menuCode,
    state,
    state.language === 'rw' ? 'Hitamo neza. Gerageza nanone.' : 'Invalid choice. Please try again.',
    context,
  );
}

function exitStep(state: UssdSessionState, maxChars: number): UssdMenuStep {
  const message =
    state.language === 'rw'
      ? 'Murakoze gukoresha MenyaMuhinzi.'
      : 'Thank you for using MenyaMuhinzi.';
  return {
    menuCode: 'MAIN',
    state,
    message: truncate(message, maxChars),
    continueSession: false,
    userExit: true,
  };
}

function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text);
  return chars.length <= maxChars ? text : `${chars.slice(0, Math.max(0, maxChars - 1)).join('')}…`;
}
