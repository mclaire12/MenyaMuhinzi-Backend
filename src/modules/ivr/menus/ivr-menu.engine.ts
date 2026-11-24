import type { Language } from '../../../generated/prisma/client';
import type {
  TelephonyCourseOption,
  TelephonyLessonOption,
  TelephonyModuleOption,
} from '../../telephony/telephony-learning.service';

export type IvrMenuCode =
  | 'LANGUAGE'
  | 'MAIN'
  | 'COURSE_LIST'
  | 'MY_COURSES'
  | 'COURSE_CONFIRM'
  | 'MODULE_LIST'
  | 'LESSON_LIST'
  | 'LESSON';

export interface IvrSessionState {
  language: Language;
  menuCode: IvrMenuCode;
  courseId?: string;
  courseCompleted?: boolean;
  moduleId?: string;
  lessonId?: string;
  learningSessionId?: string;
  coursePage?: number;
  modulePage?: number;
  lessonPage?: number;
  courseOptions?: TelephonyCourseOption[];
  moduleOptions?: TelephonyModuleOption[];
  lessonOptions?: TelephonyLessonOption[];
}

export type IvrMenuAction =
  | { type: 'enroll'; courseId: string }
  | { type: 'play-lesson'; lessonId: string }
  | { type: 'complete-lesson'; lessonId: string; learningSessionId?: string };

export interface IvrMenuStep {
  message: string;
  state: IvrSessionState;
  continueSession: boolean;
  playLesson?: boolean;
  action?: IvrMenuAction;
}

export interface IvrMenuContext {
  courses: TelephonyCourseOption[];
  modules?: TelephonyModuleOption[];
  lessons?: TelephonyLessonOption[];
  continuation?: { courseId: string; lessonId: string };
  progressSummary: string;
  audioAvailable: boolean;
}

const PAGE_SIZE = 8;

export function initialIvrState(language: Language): IvrSessionState {
  return { language, menuCode: 'LANGUAGE' };
}

export function handleIvrInput(
  state: IvrSessionState,
  digits: string,
  context: IvrMenuContext,
): IvrMenuStep {
  const input = digits.trim().slice(-1);
  if (state.menuCode === 'LANGUAGE') {
    if (!input) {
      return result(
        state,
        state.language === 'rw'
          ? 'Murakaza neza. Kinyarwanda kanda 1, English kanda 2.'
          : 'Welcome. Press 1 for Kinyarwanda or 2 for English.',
      );
    }
    if (input === '1' || input === '2') {
      const language = input === '1' ? 'rw' : 'en';
      return result(
        { ...state, language, menuCode: 'MAIN' },
        language === 'rw'
          ? 'Hitamo: 1 kwiga, 2 amasomo yanjye, 3 gukomeza, 4 aho ngeze, 0 gusohoka.'
          : 'Press 1 to learn, 2 for my courses, 3 to continue, 4 for progress, or 0 to exit.',
      );
    }
    if (input === '0') return result({ ...state, menuCode: 'MAIN' }, mainPrompt(state.language));
    return invalid(state);
  }

  if (state.menuCode === 'MAIN') {
    if (!input) return result(state, mainPrompt(state.language));
    if (input === '0')
      return result(state, state.language === 'rw' ? 'Murakoze.' : 'Thank you.', false);
    if (input === '1') {
      return listResult(
        { ...state, menuCode: 'COURSE_LIST', coursePage: 0 },
        context.courses,
        state.language,
      );
    }
    if (input === '2') {
      return listResult(
        { ...state, menuCode: 'MY_COURSES', coursePage: 0 },
        context.courses.filter((course) => course.activeEnrollment || course.completedEnrollment),
        state.language,
      );
    }
    if (input === '3') {
      if (!context.continuation) {
        return result(
          state,
          state.language === 'rw' ? 'Nta somo ryo gukomeza.' : 'No lesson to continue.',
        );
      }
      const nextState = {
        ...state,
        menuCode: 'LESSON' as const,
        courseId: context.continuation.courseId,
        lessonId: context.continuation.lessonId,
      };
      return playStep(nextState, context);
    }
    if (input === '4') return result(state, context.progressSummary);
    if (input === '5') return result({ ...state, menuCode: 'LANGUAGE' }, languagePrompt(state.language));
    if (input === '6')
      return result(
        state,
        state.language === 'rw'
          ? 'Hamagara umufashamyumvire wawe kugira ngo agufashe.'
          : 'Contact your facilitator for help.',
      );
    return invalid(state);
  }

  if (state.menuCode === 'COURSE_LIST' || state.menuCode === 'MY_COURSES') {
    const options =
      state.menuCode === 'MY_COURSES'
        ? context.courses.filter((course) => course.activeEnrollment || course.completedEnrollment)
        : context.courses;
    return selectFromList(state, input, options, 'coursePage', state.language, (selected) => {
      const nextState = {
        ...state,
        courseId: selected.id,
        courseCompleted: selected.completedEnrollment,
        menuCode: selected.activeEnrollment || selected.completedEnrollment
          ? ('MODULE_LIST' as const)
          : ('COURSE_CONFIRM' as const),
        modulePage: 0,
        moduleOptions: context.modules ?? [],
      };
      if (selected.activeEnrollment || selected.completedEnrollment) {
        return listResult(nextState, context.modules ?? [], state.language);
      }
      return result(
        nextState,
        state.language === 'rw'
          ? 'Kanda 1 kugira ngo wiyandikishe, 0 usubire inyuma.'
          : 'Press 1 to enroll, or 0 to go back.',
      );
    });
  }

  if (state.menuCode === 'COURSE_CONFIRM') {
    if (input === '0') return result({ ...state, menuCode: 'MAIN' }, mainPrompt(state.language));
    if (input !== '1' || !state.courseId) return invalid(state);
    const nextState = {
      ...state,
      menuCode: 'MODULE_LIST' as const,
      modulePage: 0,
      moduleOptions: context.modules ?? [],
    };
    return {
      ...listResult(nextState, context.modules ?? [], state.language),
      action: { type: 'enroll', courseId: state.courseId },
    };
  }

  if (state.menuCode === 'MODULE_LIST') {
    return selectFromList(
      state,
      input,
      state.moduleOptions ?? [],
      'modulePage',
      state.language,
      (selected) =>
        listResult(
          {
            ...state,
            moduleId: selected.id,
            menuCode: 'LESSON_LIST',
            lessonPage: 0,
            lessonOptions: context.lessons ?? [],
          },
          context.lessons ?? [],
          state.language,
        ),
    );
  }

  if (state.menuCode === 'LESSON_LIST') {
    return selectFromList(
      state,
      input,
      state.lessonOptions ?? [],
      'lessonPage',
      state.language,
      (selected) => playStep({ ...state, lessonId: selected.id, menuCode: 'LESSON' }, context),
    );
  }

  if (state.menuCode === 'LESSON') {
    if (input === '0') return result({ ...state, menuCode: 'MAIN' }, mainPrompt(state.language));
    if (input === '1' && state.lessonId) return playStep(state, context);
    if (input === '2' && state.lessonId) {
      return {
        ...result(
          { language: state.language, menuCode: 'MAIN' },
          state.courseCompleted
            ? state.language === 'rw'
              ? 'Iri somo ryararangiye.'
              : 'This lesson is already completed.'
            : state.language === 'rw'
              ? 'Isomo rirangiye.'
              : 'Lesson completed.',
        ),
        action: state.courseCompleted
          ? undefined
          : {
              type: 'complete-lesson',
              lessonId: state.lessonId,
              learningSessionId: state.learningSessionId,
            },
      };
    }
    return invalid(state);
  }

  return invalid(state);
}

function playStep(state: IvrSessionState, context: IvrMenuContext): IvrMenuStep {
  if (!context.audioAvailable) {
    return {
      ...result(
        state,
        state.language === 'rw'
          ? 'Amajwi ntabwo aboneka. Nta serivisi yo gutanga amajwi irashyirwaho.'
          : 'Audio is unavailable. No voice provider is configured.',
      ),
      playLesson: true,
    };
  }
  return {
    ...result(
      state,
      state.language === 'rw'
        ? 'Isomo ririmo gukinwa. Kanda 1 kurisubiramo, 2 kurangiza, 0 gusubira kuri menu.'
        : 'Lesson audio requested. Press 1 to repeat, 2 when finished, or 0 for the menu.',
    ),
    playLesson: true,
    action: state.lessonId ? { type: 'play-lesson', lessonId: state.lessonId } : undefined,
  };
}

function selectFromList<
  T extends TelephonyCourseOption | TelephonyModuleOption | TelephonyLessonOption,
>(
  state: IvrSessionState,
  input: string,
  options: T[],
  pageProperty: 'coursePage' | 'modulePage' | 'lessonPage',
  language: Language,
  onSelect: (option: T) => IvrMenuStep,
): IvrMenuStep {
  const page = state[pageProperty] ?? 0;
  if (input === '9' && (page + 1) * PAGE_SIZE < options.length) {
    return listResult({ ...state, [pageProperty]: page + 1 }, options, language);
  }
  if (input === '0') return result({ ...state, menuCode: 'MAIN' }, mainPrompt(language));
  const selection = Number.parseInt(input, 10);
  const option = options[page * PAGE_SIZE + selection - 1];
  if (!Number.isInteger(selection) || selection < 1 || selection > PAGE_SIZE || !option)
    return invalid(state);
  return onSelect(option);
}

function listResult(
  state: IvrSessionState,
  options: Array<TelephonyCourseOption | TelephonyModuleOption | TelephonyLessonOption>,
  language: Language,
): IvrMenuStep {
  const property =
    state.menuCode === 'COURSE_LIST' || state.menuCode === 'MY_COURSES'
      ? 'coursePage'
      : state.menuCode === 'MODULE_LIST'
        ? 'modulePage'
        : 'lessonPage';
  const page = state[property] ?? 0;
  const items = options.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const lines = items.length
    ? items.map((item, index) => `${index + 1}. ${item.title}`).join('. ')
    : language === 'rw'
      ? 'Nta masomo aboneka.'
      : 'Nothing is available.';
  const more =
    (page + 1) * PAGE_SIZE < options.length
      ? language === 'rw'
        ? ' Kanda 9 ku bikurikira.'
        : ' Press 9 for more.'
      : '';
  return result(
    state,
    `${lines}.${more} ${language === 'rw' ? '0 gusubira kuri menu.' : '0 for menu.'}`,
  );
}

function mainPrompt(language: Language): string {
  return language === 'rw'
    ? '1 Kwiga, 2 Amasomo yanjye, 3 Komeza, 4 Aho ngeze, 5 Ururimi, 6 Ubufasha, 0 Sohoka.'
    : '1 Learn, 2 My courses, 3 Continue, 4 Progress, 5 Language, 6 Help, 0 Exit.';
}

function languagePrompt(language: Language): string {
  return language === 'rw'
    ? 'Kinyarwanda kanda 1, English kanda 2.'
    : 'Press 1 for Kinyarwanda or 2 for English.';
}

function invalid(state: IvrSessionState): IvrMenuStep {
  return result(state, state.language === 'rw' ? 'Hitamo neza.' : 'Invalid choice.');
}

function result(state: IvrSessionState, message: string, continueSession = true): IvrMenuStep {
  return { state, message, continueSession };
}
