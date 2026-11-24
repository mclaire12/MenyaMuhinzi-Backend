/** Server-to-server headers for the Vercel BFF. Never expose values in logs or JSON bodies. */
export const BFF_SECRET_HEADER = 'x-menya-bff-secret';
export const WEB_SESSION_HEADER = 'x-menya-web-session';
export const ACCESS_TOKEN_HEADER = 'x-menya-access-token';
export const ACCESS_EXPIRES_HEADER = 'x-menya-access-expires-in';

export const BFF_PROTECTED_KEY = 'auth:bffProtected';