import { BadRequestException } from '@nestjs/common';
import {
  countByUtcDay,
  parseDateRange,
  seriesFromCounts,
  timestampFilter,
  utcDayKey,
} from './date-range';

describe('report date range', () => {
  it('rejects inverted ranges', () => {
    expect(() => parseDateRange(new Date('2026-02-01'), new Date('2026-01-01'))).toThrow(
      BadRequestException,
    );
  });

  it('builds an inclusive-start exclusive-end filter', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-02-01T00:00:00.000Z');
    expect(timestampFilter(parseDateRange(start, end))).toEqual({ gte: start, lt: end });
    expect(timestampFilter({})).toBeUndefined();
  });

  it('groups timestamps by UTC day', () => {
    const counts = countByUtcDay([
      new Date('2026-01-01T10:00:00.000Z'),
      new Date('2026-01-01T23:00:00.000Z'),
      new Date('2026-01-02T01:00:00.000Z'),
    ]);
    expect(utcDayKey(new Date('2026-01-01T10:00:00.000Z'))).toBe('2026-01-01');
    expect(seriesFromCounts(counts)).toEqual([
      { date: '2026-01-01', count: 2 },
      { date: '2026-01-02', count: 1 },
    ]);
  });
});
