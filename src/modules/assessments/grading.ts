import { AttemptStatus, QuestionType } from '../../generated/prisma/client';

export interface GradedQuestion {
  questionType: QuestionType;
  marks: number;
  options: { id: string; text: string }[] | null;
  correctAnswer: unknown;
}

export interface GradeResult {
  awardedMarks: number | null;
  pending: boolean;
}

export function gradeResponse(question: GradedQuestion, response: unknown): GradeResult {
  if (question.questionType === QuestionType.SHORT_ANSWER) {
    if (typeof response !== 'string' || response.trim().length === 0) {
      throw new Error('A short answer must be text');
    }
    return { awardedMarks: null, pending: true };
  }
  if (question.questionType === QuestionType.TRUE_FALSE) {
    if (typeof response !== 'boolean') throw new Error('A true/false answer must be true or false');
    return {
      awardedMarks: response === question.correctAnswer ? question.marks : 0,
      pending: false,
    };
  }
  if (
    typeof response !== 'string' ||
    !(question.options ?? []).some((option) => option.id === response)
  ) {
    throw new Error('Choose one of the options');
  }
  return { awardedMarks: response === question.correctAnswer ? question.marks : 0, pending: false };
}

export interface AttemptScore {
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean | null;
  status: AttemptStatus;
}

/** Pending short answers count as zero until a reviewer scores them. A timeout cannot pass. */
export function summarizeAttempt(
  parts: { awardedMarks: number | null; marks: number }[],
  passingScore: number,
  timedOut: boolean,
): AttemptScore {
  const pending = parts.some((part) => part.awardedMarks === null);
  const score = parts.reduce((sum, part) => sum + (part.awardedMarks ?? 0), 0);
  const maxScore = parts.reduce((sum, part) => sum + part.marks, 0);
  const percentage = maxScore === 0 ? 0 : Math.round((score / maxScore) * 100);
  if (pending) {
    return { score, maxScore, percentage, passed: null, status: AttemptStatus.PENDING_REVIEW };
  }
  const passed = !timedOut && percentage >= passingScore;
  return {
    score,
    maxScore,
    percentage,
    passed,
    status: passed ? AttemptStatus.PASSED : AttemptStatus.FAILED,
  };
}
