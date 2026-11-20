import { DURATION_PATTERN, parseDuration } from './duration';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000],
  ])('converts %s to %d ms', (value, expected) => {
    expect(parseDuration(value)).toBe(expected);
  });

  it.each(['15', '1w', '-5m', '1.5h', 'm15', ''])('rejects %p', (value) => {
    expect(DURATION_PATTERN.test(value)).toBe(false);
    expect(() => parseDuration(value)).toThrow();
  });
});
