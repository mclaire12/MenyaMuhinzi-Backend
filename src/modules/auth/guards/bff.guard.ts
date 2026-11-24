import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { webSessionConfig } from '../../../config/configuration';
import { BFF_PROTECTED_KEY, BFF_SECRET_HEADER } from '../web-session.constants';

function safeEqual(expected: string, provided: string): boolean {
  const expectedBuf = createHmac('sha256', 'bff-compare').update(expected).digest();
  const providedBuf = createHmac('sha256', 'bff-compare').update(provided).digest();
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Protects web-session routes for the Vercel BFF only.
 * Rejects missing secrets, browser `Origin`, and `Sec-Fetch-Site` hints.
 */
@Injectable()
export class BffGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly reflector: Reflector,
    @Inject(webSessionConfig.KEY) webSession: ConfigType<typeof webSessionConfig>,
  ) {
    if (!webSession.bffSharedSecret || webSession.bffSharedSecret.length < 32) {
      throw new Error('MENYA_BFF_SHARED_SECRET is missing or invalid');
    }
    this.secret = webSession.bffSharedSecret;
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (!this.reflector.getAllAndOverride<boolean>(BFF_PROTECTED_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.origin || request.headers['sec-fetch-site']) {
      throw new ForbiddenException('This endpoint is not available from a browser');
    }

    const provided = headerValue(request.headers[BFF_SECRET_HEADER]);
    if (!provided || !safeEqual(this.secret, provided)) {
      throw new UnauthorizedException('Invalid BFF credentials');
    }
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}