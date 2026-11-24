import { BadRequestException } from '@nestjs/common';

/**
 * Inclusive start, exclusive end. Both bounds are interpreted as UTC instants.
 * When only a calendar date is supplied (midnight), `endDate` is the first instant
 * of the following day so the whole end calendar day is included.
 */
export interface DateRange {
  start?: Date;
  end?: Date;
}

export function parseDateRange(startDate?: Date, endDate?: Date): DateRange {
  if (startDate && Number.isNaN(startDate.getTime())) {
    throw new BadRequestException('startDate must be a valid date');
  }
  if (endDate && Number.isNaN(endDate.getTime())) {
    throw new BadRequestException('endDate must be a valid date');
  }
  if (startDate && endDate && startDate.getTime() >= endDate.getTime()) {
    throw new BadRequestException('startDate must be before endDate');
  }
  return { start: startDate, end: endDate };
}

/** Prisma-style filter for a timestamp column. */
export function timestampFilter(range: DateRange): { gte?: Date; lt?: Date } | undefined {
  if (!range.start && !range.end) return undefined;
  return {
    ...(range.start ? { gte: range.start } : {}),
    ...(range.end ? { lt: range.end } : {}),
  };
}

/** Truncate a Date to UTC calendar day for series keys. */
export function utcDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Group timestamps into UTC day buckets. Empty ranges yield an empty map.
 * Callers that need week/month can roll day keys up later.
 */
export function countByUtcDay(dates: Date[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = utcDayKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function seriesFromCounts(counts: Map<string, number>): { date: string; count: number }[] {
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}
