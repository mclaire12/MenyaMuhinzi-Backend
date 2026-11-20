import { AttemptStatus, QuestionType } from '../../generated/prisma/client';
import { gradeResponse, summarizeAttempt } from './grading';

describe('assessment grading', () => {
  const choice = {
    questionType: QuestionType.MULTIPLE_CHOICE,
    marks: 2,
    options: [
      { id: 'a', text: 'Yes' },
      { id: 'b', text: 'No' },
    ],
    correctAnswer: 'a',
  };

  it('scores a multiple-choice answer and rejects an unknown option', () => {
    expect(gradeResponse(choice, 'a')).toEqual({ awardedMarks: 2, pending: false });
    expect(gradeResponse(choice, 'b').awardedMarks).toBe(0);
    expect(() => gradeResponse(choice, 'c')).toThrow(/options/);
  });

  it('scores true/false and holds short answers for review', () => {
    const truth = {
      questionType: QuestionType.TRUE_FALSE,
      marks: 1,
      options: null,
      correctAnswer: true,
    };
    expect(gradeResponse(truth, false)).toEqual({ awardedMarks: 0, pending: false });
    const written = {
      questionType: QuestionType.SHORT_ANSWER,
      marks: 3,
      options: null,
      correctAnswer: null,
    };
    expect(gradeResponse(written, 'Mulch keeps moisture')).toEqual({
      awardedMarks: null,
      pending: true,
    });
  });

  it('fails a timed-out attempt even when the score is high enough', () => {
    const open = summarizeAttempt([{ awardedMarks: null, marks: 2 }], 50, false);
    expect(open.status).toBe(AttemptStatus.PENDING_REVIEW);
    expect(open.passed).toBeNull();
    const late = summarizeAttempt([{ awardedMarks: 2, marks: 2 }], 50, true);
    expect(late.passed).toBe(false);
    expect(late.status).toBe(AttemptStatus.FAILED);
    expect(late.percentage).toBe(100);
  });
});
