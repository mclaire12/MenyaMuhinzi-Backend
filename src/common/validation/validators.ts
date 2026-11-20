import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, Matches, MaxLength, MinLength } from 'class-validator';
import { normalizeRwandanPhone, RWANDAN_PHONE_E164, RWANDAN_PHONE_MESSAGE } from '../utils/phone';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Accepts common Rwandan formats and stores the number as E.164 (+2507XXXXXXXX). */
export function IsRwandanPhone(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? normalizeRwandanPhone(value) : value)),
    Matches(RWANDAN_PHONE_E164, { message: RWANDAN_PHONE_MESSAGE }),
  );
}

/** Lower-cases and trims before validating. */
export function IsNormalizedEmail(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)),
    IsEmail({}, { message: '$property must be a valid email address' }),
    MaxLength(254),
  );
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** At least 8 characters with at least one letter and one digit. */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    MinLength(PASSWORD_MIN_LENGTH),
    MaxLength(PASSWORD_MAX_LENGTH),
    Matches(/[A-Za-z]/, { message: '$property must contain at least one letter' }),
    Matches(/\d/, { message: '$property must contain at least one digit' }),
  );
}

/** Trims surrounding whitespace from strings. */
export function Trim(): PropertyDecorator {
  return Transform(trim);
}
