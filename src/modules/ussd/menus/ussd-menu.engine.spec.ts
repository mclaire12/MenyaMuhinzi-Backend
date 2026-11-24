import { QuestionType } from '../../../generated/prisma/client';
import {
  handleMenuInput,
  initialState,
  type UssdMenuContext,
  type UssdSessionState,
} from './ussd-menu.engine';

const course = {
  id: 'course-1',
  title: 'Tomatoes',
  activeEnrollment: false,
  completedEnrollment: false,
};
const courseModule = { id: 'module-1', title: 'Growing' };
const lesson = { id: 'lesson-1', title: 'Watering' };

function context(overrides: Partial<UssdMenuContext> = {}): UssdMenuContext {
  return {
    maxChars: 160,
    courses: [course],
    modules: [],
    lessons: [],
    progressSummary: '0 courses',
    ...overrides,
  };
}

describe('ussd menu engine', () => {
  it('renders bilingual MAIN menus', () => {
    const rw = handleMenuInput(initialState('rw'), '', {
      maxChars: 160,
      courses: [],
      progressSummary: '0 active',
    });
    expect(rw.message).toContain('Kwiga ubuhinzi');

    const en = handleMenuInput(initialState('en'), '', {
      maxChars: 160,
      courses: [],
      progressSummary: '0 active',
    });
    expect(en.message).toContain('Learn agriculture');
  });

  it('ends the session when the farmer selects exit', () => {
    const step = handleMenuInput(initialState('en'), '0', context());
    expect(step.continueSession).toBe(false);
    expect(step.userExit).toBe(true);
  });

  it('switches language and rejects a choice that is not in the language menu', () => {
    const language = handleMenuInput(initialState('rw'), '5', context());
    expect(language.menuCode).toBe('LANGUAGE');
    expect(handleMenuInput(language.state, '9', context()).menuCode).toBe('LANGUAGE');
    expect(handleMenuInput(language.state, '2', context()).state.language).toBe('en');
  });

  it('navigates from an authorized course to its lesson and starts a shared learning session', () => {
    let state: UssdSessionState = initialState('en');
    state = handleMenuInput(state, '1', context()).state;
    state = handleMenuInput(state, '1', context()).state;
    expect(state.menuCode).toBe('COURSE_CONFIRM');

    const modules = [{ id: courseModule.id, title: courseModule.title }];
    const enrolled = handleMenuInput(state, '1', context({ modules }));
    expect(enrolled.action).toEqual({ type: 'enroll', courseId: course.id });
    state = enrolled.state;
    state = handleMenuInput(state, '1', context({ lessons: [lesson] })).state;

    const opened = handleMenuInput(
      state,
      '1',
      context({
        lessons: [lesson],
        lessonPage: { title: lesson.title, body: 'Keep soil moist.', page: 1, total: 1 },
      }),
    );
    expect(opened.action).toEqual({ type: 'start-lesson', lessonId: lesson.id });
    expect(opened.message).toContain('Keep soil moist.');
  });

  it('pages lesson content and only completes after the explicit completion choice', () => {
    const state: UssdSessionState = {
      ...initialState('en'),
      menuCode: 'LESSON_CONTENT',
      lessonId: lesson.id,
      learningSessionId: 'learning-session-1',
      contentPage: 1,
    };
    const next = handleMenuInput(
      state,
      '9',
      context({ lessonPage: { title: lesson.title, body: 'Next page.', page: 2, total: 2 } }),
    );
    expect(next.state.contentPage).toBe(2);
    expect(next.message).toContain('Next page.');
    const completed = handleMenuInput(state, '8', context());
    expect(completed.action).toEqual({
      type: 'complete-lesson',
      lessonId: lesson.id,
      learningSessionId: 'learning-session-1',
    });
  });

  it('starts and submits supported multiple-choice assessments through the LMS action boundary', () => {
    const assessment = {
      id: 'assessment-1',
      title: 'Tomato quiz',
      questions: [
        {
          id: 'question-1',
          text: 'When should tomatoes be watered?',
          questionType: QuestionType.MULTIPLE_CHOICE,
          options: [
            { id: 'option-1', text: 'Morning' },
            { id: 'option-2', text: 'Midday' },
          ],
        },
      ],
    };
    const contextWithAssessment = context({ assessments: [assessment] });
    const state: UssdSessionState = {
      ...initialState('en'),
      courseId: course.id,
    };
    const listed = handleMenuInput(state, '7', contextWithAssessment);
    const started = handleMenuInput(listed.state, '1', contextWithAssessment);
    expect(started.action).toEqual({ type: 'start-assessment', assessmentId: assessment.id });
    expect(started.message).toContain('When should tomatoes be watered?');

    const answered = handleMenuInput(
      { ...started.state, assessmentAttemptId: 'attempt-1' },
      '1',
      contextWithAssessment,
    );
    expect(answered.action).toEqual({
      type: 'submit-assessment',
      attemptId: 'attempt-1',
      answers: [{ questionId: 'question-1', selectedOptionId: 'option-1' }],
    });
  });
});
