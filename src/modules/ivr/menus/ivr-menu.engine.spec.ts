import {
  handleIvrInput,
  initialIvrState,
  type IvrMenuContext,
  type IvrSessionState,
} from './ivr-menu.engine';

const context: IvrMenuContext = {
  courses: [],
  progressSummary: '0 active courses',
  audioAvailable: false,
};

describe('ivr menu engine', () => {
  it('offers language selection in the preferred language', () => {
    const step = handleIvrInput(initialIvrState('rw'), '', context);
    expect(step.message).toContain('Kinyarwanda');
  });

  it('reports audio unavailable instead of creating a playback action', () => {
    const lessonState: IvrSessionState = {
      language: 'en',
      menuCode: 'LESSON',
      lessonId: 'lesson-1',
    };
    const step = handleIvrInput(lessonState, '1', context);
    expect(step.playLesson).toBe(true);
    expect(step.message).toContain('Audio is unavailable');
    expect(step.action).toBeUndefined();
  });

  it('ends the call on digit 0', () => {
    const step = handleIvrInput({ language: 'rw', menuCode: 'MAIN' }, '0', context);
    expect(step.continueSession).toBe(false);
  });

  it('navigates through a published course to an audio-capable lesson', () => {
    const course = {
      id: 'course-1',
      title: 'Tomatoes',
      activeEnrollment: true,
      completedEnrollment: false,
    };
    const courseModule = { id: 'module-1', title: 'Growing' };
    const lesson = { id: 'lesson-1', title: 'Watering' };
    const audioContext: IvrMenuContext = {
      courses: [course],
      modules: [courseModule],
      lessons: [lesson],
      progressSummary: '1 course',
      audioAvailable: true,
    };

    let state: IvrSessionState = { language: 'en', menuCode: 'MAIN' };
    state = handleIvrInput(state, '1', audioContext).state;
    state = handleIvrInput(state, '1', audioContext).state;
    state = handleIvrInput(state, '1', audioContext).state;
    const selectedLesson = handleIvrInput(state, '1', audioContext);

    expect(selectedLesson.action).toEqual({ type: 'play-lesson', lessonId: lesson.id });
    expect(selectedLesson.state.menuCode).toBe('LESSON');
  });
});
