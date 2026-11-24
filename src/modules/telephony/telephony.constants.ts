export const TELEPHONY_CHANNEL = {
  Ussd: 'USSD',
  Ivr: 'IVR',
} as const;

export type TelephonyChannel = (typeof TELEPHONY_CHANNEL)[keyof typeof TELEPHONY_CHANNEL];

export const REDIS_USSD_SESSION_PREFIX = 'telephony:ussd:session:';
export const REDIS_IVR_SESSION_PREFIX = 'telephony:ivr:session:';