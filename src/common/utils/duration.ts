export const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** Converts a duration such as `15m` or `7d` to milliseconds. */
export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}"; expected e.g. 30s, 15m, 12h or 7d`);
  }
  return Number(match[1]) * UNIT_MS[match[2]];
}
