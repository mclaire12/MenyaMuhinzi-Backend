import { LessonProgressStatus } from '../../generated/prisma/client';

export interface ProgressInput {
  percentage: number;
  status: LessonProgressStatus;
}

/** The server decides the status from the percentage. A client cannot lower progress. */
export function nextProgressState(current: ProgressInput, requested: number): ProgressInput {
  if (!Number.isInteger(requested) || requested < 0 || requested > 100) {
    throw new Error('Progress percentage must be a whole number from 0 to 100');
  }
  if (requested < current.percentage) {
    throw new Error('Progress cannot move backwards');
  }
  if (requested >= 100) return { percentage: 100, status: LessonProgressStatus.COMPLETED };
  if (requested === 0 && current.status === LessonProgressStatus.NOT_STARTED) {
    return { percentage: 0, status: LessonProgressStatus.NOT_STARTED };
  }
  return { percentage: requested, status: LessonProgressStatus.IN_PROGRESS };
}

export interface LessonSlice {
  id: string;
  moduleId: string;
}

export interface ProgressSlice {
  lessonId: string;
  status: LessonProgressStatus;
  timeSpentSeconds: number;
}

export interface ModuleProgress {
  moduleId: string;
  totalLessons: number;
  completedLessons: number;
  completionPercentage: number;
  completed: boolean;
}

export interface CourseProgressSummary {
  totalModules: number;
  completedModules: number;
  totalLessons: number;
  completedLessons: number;
  overallCompletionPercentage: number;
  totalLearningTimeSeconds: number;
  courseCompletionStatus: LessonProgressStatus;
  modules: ModuleProgress[];
}

/**
 * Course percentage is completed lessons divided by all lessons.
 * A module is complete only when it has lessons and every one of them is complete.
 * A course is complete when it has lessons and every lesson is complete.
 */
export function summarizeCourseProgress(lessons: LessonSlice[], progress: ProgressSlice[]): CourseProgressSummary {
  const byLesson = new Map(progress.map((row) => [row.lessonId, row]));
  const moduleIds = [...new Set(lessons.map((lesson) => lesson.moduleId))];
  const modules = moduleIds.map((moduleId) => {
    const inModule = lessons.filter((lesson) => lesson.moduleId === moduleId);
    const completedLessons = inModule.filter((lesson) => byLesson.get(lesson.id)?.status === LessonProgressStatus.COMPLETED).length;
    const completionPercentage = inModule.length === 0 ? 0 : Math.round((completedLessons / inModule.length) * 100);
    return {
      moduleId,
      totalLessons: inModule.length,
      completedLessons,
      completionPercentage,
      completed: inModule.length > 0 && completedLessons === inModule.length,
    };
  });
  const completedLessons = lessons.filter((lesson) => byLesson.get(lesson.id)?.status === LessonProgressStatus.COMPLETED).length;
  const overallCompletionPercentage = lessons.length === 0 ? 0 : Math.round((completedLessons / lessons.length) * 100);
  const totalLearningTimeSeconds = progress.reduce((sum, row) => sum + row.timeSpentSeconds, 0);
  const courseCompletionStatus =
    lessons.length > 0 && completedLessons === lessons.length
      ? LessonProgressStatus.COMPLETED
      : completedLessons > 0 || progress.some((row) => row.status !== LessonProgressStatus.NOT_STARTED)
        ? LessonProgressStatus.IN_PROGRESS
        : LessonProgressStatus.NOT_STARTED;
  return {
    totalModules: moduleIds.length,
    completedModules: modules.filter((module) => module.completed).length,
    totalLessons: lessons.length,
    completedLessons,
    overallCompletionPercentage,
    totalLearningTimeSeconds,
    courseCompletionStatus,
    modules,
  };
}
