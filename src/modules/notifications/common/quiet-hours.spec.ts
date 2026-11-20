import { isValidTime, isValidTimeZone, quietHoursDelayMs } from './quiet-hours';

// Africa/Kigali is UTC+2 all year.
const quiet = { enabled: true, start: '21:00', end: '06:00', timeZone: 'Africa/Kigali' };

describe('quiet hours', () => {
  it('validates times and time zones', () => {
    expect(isValidTime('06:30')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('6:30')).toBe(false);
    expect(isValidTimeZone('Africa/Kigali')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('returns null outside the window and when disabled', () => {
    expect(quietHoursDelayMs(quiet, new Date('2026-11-20T10:00:00Z'))).toBeNull(); // 12:00 local
    expect(
      quietHoursDelayMs({ ...quiet, enabled: false }, new Date('2026-11-20T21:00:00Z')),
    ).toBeNull();
    expect(
      quietHoursDelayMs({ ...quiet, start: null }, new Date('2026-11-20T21:00:00Z')),
    ).toBeNull();
  });

  it('delays until the end of a window that crosses midnight', () => {
    // 22:30 local: 7.5 hours left
    expect(quietHoursDelayMs(quiet, new Date('2026-11-20T20:30:00Z'))).toBe(7.5 * 3_600_000);
    // 02:00 local: 4 hours left
    expect(quietHoursDelayMs(quiet, new Date('2026-11-21T00:00:00Z'))).toBe(4 * 3_600_000);
    // window start is inclusive, end exclusive
    expect(quietHoursDelayMs(quiet, new Date('2026-11-20T19:00:00Z'))).toBe(9 * 3_600_000);
    expect(quietHoursDelayMs(quiet, new Date('2026-11-21T04:00:00Z'))).toBeNull();
  });

  it('handles a same-day window', () => {
    const day = { ...quiet, start: '13:00', end: '15:00' };
    expect(quietHoursDelayMs(day, new Date('2026-11-20T12:00:00Z'))).toBe(3_600_000); // 14:00 local
    expect(quietHoursDelayMs(day, new Date('2026-11-20T08:00:00Z'))).toBeNull();
  });
});
