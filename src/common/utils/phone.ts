/** Rwandan mobile numbers in E.164 form: +250 followed by 72, 73, 78 or 79 and 7 digits. */
export const RWANDAN_PHONE_E164 = /^\+2507[2389]\d{7}$/;

export const RWANDAN_PHONE_MESSAGE =
  '$property must be a valid Rwandan mobile number, e.g. 0788123456 or +250788123456';

/**
 * Normalises the common ways Rwandan numbers are written (0788 123 456,
 * 250788123456, +250-788-123-456, 788123456) to E.164. Returns the input
 * unchanged when it cannot be normalised so validation can report it.
 */
export function normalizeRwandanPhone(input: string): string {
  const compact = input.replace(/[\s\-().]/g, '');
  const match = /^(?:\+?250|0)?(7\d{8})$/.exec(compact);
  return match ? `+250${match[1]}` : input;
}

export function isRwandanPhone(value: string): boolean {
  return RWANDAN_PHONE_E164.test(value);
}
