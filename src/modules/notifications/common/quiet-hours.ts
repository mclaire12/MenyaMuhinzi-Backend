export const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Local minutes since midnight and seconds into the minute for an instant in a time zone. */
function localClock(now: Date, timeZone: string): { minutes: number; seconds: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { minutes: read('hour') * 60 + read('minute'), seconds: read('second') };
}

export interface QuietHours {
  enabled: boolean;
  start: string | null;
  end: string | null;
  timeZone: string;
}

/**
 * Milliseconds until quiet hours end when `now` falls inside them, otherwise null.
 * The window may cross midnight (for example 21:00 to 06:00). Start is inclusive, end exclusive.
 */
export function quietHoursDelayMs(quiet: QuietHours, now: Date = new Date()): number | null {
  if (!quiet.enabled || !quiet.start || !quiet.end || !isValidTimeZone(quiet.timeZone)) return null;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === end) return null;
  const { minutes, seconds } = localClock(now, quiet.timeZone);
  const inside =
    start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  if (!inside) return null;
  const minutesLeft = (end - minutes + 1440) % 1440;
  return Math.max(minutesLeft * 60_000 - seconds * 1000, 1000);
}
