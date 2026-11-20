import { LessonProgressStatus } from '../../generated/prisma/client';
import { nextProgressState, summarizeCourseProgress } from './progress-summary';

describe('learning progress', () => {
  it('derives the status from the percentage and refuses to go backwards', () => {
    expect(nextProgressState({ percentage: 0, status: LessonProgressStatus.NOT_STARTED }, 0)).toEqual({
      percentage: 0,
      status: LessonProgressStatus.NOT_STARTED,
    });
    expect(nextProgressState({ percentage: 0, status: LessonProgressStatus.NOT_STARTED }, 40).status).toBe(
      LessonProgressStatus.IN_PROGRESS,
    );
    expect(nextProgressState({ percentage: 40, status: LessonProgressStatus.IN_PROGRESS }, 100)).toEqual({
      percentage: 100,
      status: LessonProgressStatus.COMPLETED,
    });
    expect(() => nextProgressState({ percentage: 40, status: LessonProgressStatus.IN_PROGRESS }, 10)).toThrow(
      /backwards/,
    );
  });

  it('calculates course progress from completed lessons', () => {
    const lessons = [
      { id: 'a', moduleId: 'm1' },
      { id: 'b', moduleId: 'm1' },
      { id: 'c', moduleId: 'm2' },
    ];
    const summary = summarizeCourseProgress(lessons, [
      { lessonId: 'a', status: LessonProgressStatus.COMPLETED, timeSpentSeconds: 30 },
      { lessonId: 'b', status: LessonProgressStatus.IN_PROGRESS, timeSpentSeconds: 10 },
      { lessonId: 'c', status: LessonProgressStatus.COMPLETED, timeSpentSeconds: 5 },
    ]);
    expect(summary.totalModules).toBe(2);
    expect(summary.completedModules).toBe(1);
    expect(summary.completedLessons).toBe(2);
    expect(summary.overallCompletionPercentage).toBe(67);
    expect(summary.totalLearningTimeSeconds).toBe(45);
    expect(summary.courseCompletionStatus).toBe(LessonProgressStatus.IN_PROGRESS);
  });
});
