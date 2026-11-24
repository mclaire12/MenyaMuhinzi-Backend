import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { WEB_SESSION_HEADER } from '../web-session.constants';

export const WebSessionId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const header = ctx.switchToHttp().getRequest<Request>().headers[WEB_SESSION_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.trim()) {
    throw new UnauthorizedException('Session identifier is required');
  }
  return value.trim();
});