import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { appConfig, loggerConfig } from '../../config/configuration';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Request fields removed from structured logs. Values are never written. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-menya-web-session"]',
  'req.headers["x-menya-bff-secret"]',
  'req.headers["x-menya-access-token"]',
  'res.headers["set-cookie"]',
  'res.headers["x-menya-web-session"]',
  'res.headers["x-menya-access-token"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.body.token',
  'req.body.sessionId',
];

/**
 * Structured JSON logging (pino) with a request id propagated on every log line
 * and echoed back in the `x-request-id` response header.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [appConfig.KEY, loggerConfig.KEY],
      useFactory: (app: ConfigType<typeof appConfig>, logger: ConfigType<typeof loggerConfig>) => ({
        pinoHttp: {
          level: logger.level,
          base: { service: app.name, env: app.env },
          transport: logger.pretty
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const header = req.headers[REQUEST_ID_HEADER];
            const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },
          redact: {
            paths: LOG_REDACT_PATHS,
            censor: '[REDACTED]',
          },
          customLogLevel: (_req: IncomingMessage, res: ServerResponse, error?: Error) => {
            if (error || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
        },
      }),
    }),
  ],
})
export class LoggerModule {}
