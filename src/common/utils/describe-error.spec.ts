import { describeError } from './describe-error';

describe('describeError', () => {
  it('returns the message of a plain error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('joins the distinct inner errors of an AggregateError', () => {
    const error = new AggregateError(
      [new Error('connect ECONNREFUSED ::1:6379'), new Error('connect ECONNREFUSED 127.0.0.1:6379')],
      '',
    );

    expect(describeError(error)).toBe(
      'connect ECONNREFUSED ::1:6379; connect ECONNREFUSED 127.0.0.1:6379',
    );
  });

  it('falls back to the error code when the message only contains a header', () => {
    const error = Object.assign(new Error('\nInvalid `prisma.$queryRaw()` invocation:\n\n'), {
      code: 'ECONNREFUSED',
    });

    expect(describeError(error)).toBe('ECONNREFUSED');
  });

  it('includes the cause', () => {
    const error = new Error('query failed', { cause: new Error('socket closed') });

    expect(describeError(error)).toBe('query failed: socket closed');
  });

  it('stringifies non-error values', () => {
    expect(describeError('timeout')).toBe('timeout');
  });
});
