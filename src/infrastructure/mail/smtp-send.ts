import nodemailer from 'nodemailer';

export interface SmtpSettings {
  host?: string | undefined;
  port: number;
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
}

export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** Network-level failures that are worth retrying (seen intermittently with Gmail on port 587). */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
  'EPIPE',
  'ECONNREFUSED',
  'EAI_AGAIN',
]);

export function isTransientSmtpError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, responseCode } = error as { code?: string; responseCode?: number };
  if (code && TRANSIENT_CODES.has(code)) return true;
  // 4xx SMTP replies are temporary by definition (RFC 5321); 5xx are permanent.
  return typeof responseCode === 'number' && responseCode >= 400 && responseCode < 500;
}

/**
 * Sends one message, retrying transient connection failures with a fresh connection.
 * Resolves with the provider message id; rejects with the last error otherwise.
 */
export async function sendSmtpMail(
  settings: SmtpSettings,
  message: SmtpMessage,
  options: { attempts?: number; backoffMs?: number } = {},
): Promise<{ messageId: string | undefined; attempts: number }> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const backoffMs = options.backoffMs ?? 750;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.user ? { user: settings.user, pass: settings.password ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    try {
      const info = await transport.sendMail(message);
      return { messageId: info.messageId, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransientSmtpError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    } finally {
      transport.close();
    }
  }
  throw lastError;
}

export function describeSmtpError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'send failed';
  const { code, responseCode, message } = error as {
    code?: string;
    responseCode?: number;
    message?: string;
  };
  return [code, responseCode, message].filter(Boolean).join(' ') || 'send failed';
}
