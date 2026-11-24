import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { Permission } from '../../roles/rbac.constants';
import type { CurrentUserResponseDto } from '../../users/dto/user-response.dto';
import {
  toUserDetailResponse,
  toUserResponse,
  userDetailSelect,
  userSummarySelect,
  type UserDetailRecord,
} from '../../users/user.mapper';
import { AuthService } from '../auth.service';
import type { ClientContext } from '../auth.types';
import type { LoginDto } from '../dto/auth-request.dto';
import type { WebSessionCreatedResponseDto } from '../dto/web-session.dto';
import { WebSessionLockService } from './web-session-lock.service';
import { TokenService } from './token.service';
import { WebSessionService } from './web-session.service';

export interface WebSessionRefreshOutcome {
  sessionId: string;
  accessToken: string;
  expiresIn: number;
}

const currentUserSelect = {
  ...userDetailSelect,
  roles: {
    select: {
      role: {
        select: {
          code: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      },
    },
    orderBy: { assignedAt: 'asc' as const },
  },
};

@Injectable()
export class WebSessionAuthService {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: WebSessionService,
    private readonly tokens: TokenService,
    private readonly locks: WebSessionLockService,
    private readonly prisma: PrismaService,
  ) {}

  async create(dto: LoginDto, client: ClientContext): Promise<{ body: WebSessionCreatedResponseDto; sessionId: string }> {
    const authenticated = await this.auth.authenticateActiveLogin(dto, client);
    const profile = await this.prisma.user.findUniqueOrThrow({
      where: { id: authenticated.userId },
      select: userSummarySelect,
    });
    const { sessionId } = await this.sessions.create({
      userId: authenticated.userId,
      passwordChangedAt: authenticated.passwordChangedAt,
      client,
    });
    const stored = await this.sessions.findBySessionId(sessionId);
    if (!stored) throw new ServiceUnavailableException('Unable to create a web session');

    return {
      sessionId,
      body: {
        user: toUserResponse(profile),
        idleExpiresAt: stored.idleExpiresAt,
        absoluteExpiresAt: stored.absoluteExpiresAt,
      },
    };
  }

  async currentUser(sessionId: string): Promise<CurrentUserResponseDto> {
    const validation = await this.sessions.validate(sessionId);
    if (!validation.ok) throw this.unauthorizedFor(validation.reason);
    return this.loadCurrentUser(validation.session.userId);
  }

  async refresh(sessionId: string, client: ClientContext): Promise<WebSessionRefreshOutcome> {
    const validation = await this.sessions.validate(sessionId);
    if (!validation.ok) throw this.unauthorizedFor(validation.reason);

    const stored = await this.sessions.findBySessionId(sessionId);
    if (!stored) throw new UnauthorizedException('Session is invalid or has expired');
    const sessionHash = stored.sessionHash;
    const fromVersion = validation.session.sessionVersion;

    const lock = await this.locks.acquire(sessionHash);
    if (lock.acquired) {
      try {
        const latest = await this.sessions.findBySessionId(sessionId);
        if (!latest || latest.revokedAt || latest.sessionVersion !== fromVersion) {
          const recovered = await this.locks.waitForRefreshResult(sessionHash, fromVersion);
          if (!recovered) throw new ServiceUnavailableException('Session refresh could not be completed safely');
          return {
            sessionId: recovered.sessionId,
            accessToken: recovered.accessToken,
            expiresIn: recovered.expiresIn,
          };
        }

        const refreshToken = await this.sessions.decryptRefreshToken(sessionId);
        if (!refreshToken) throw new UnauthorizedException('Session is invalid or has expired');

        const rotated = await this.tokens.rotate(refreshToken, client);
        const committed = await this.sessions.commitRotatedCredentials(sessionId, fromVersion, {
          refreshToken: rotated.refreshToken,
          refreshTokenId: rotated.refreshTokenId,
          familyId: latest.familyId,
        });
        if (!committed) {
          const recovered = await this.locks.waitForRefreshResult(sessionHash, fromVersion);
          if (!recovered) throw new ServiceUnavailableException('Session refresh could not be completed safely');
          return {
            sessionId: recovered.sessionId,
            accessToken: recovered.accessToken,
            expiresIn: recovered.expiresIn,
          };
        }

        await this.locks.storeRefreshResult(sessionHash, {
          fromVersion,
          sessionId: committed.nextSessionId,
          accessToken: rotated.accessToken,
          expiresIn: rotated.expiresIn,
        });

        return {
          sessionId: committed.nextSessionId,
          accessToken: rotated.accessToken,
          expiresIn: rotated.expiresIn,
        };
      } finally {
        await this.locks.release(lock.lock);
      }
    }

    if (lock.reason === 'unavailable') {
      throw new ServiceUnavailableException('Session coordination is temporarily unavailable');
    }

    const recovered = await this.locks.waitForRefreshResult(sessionHash, fromVersion);
    if (!recovered) throw new ServiceUnavailableException('Session refresh could not be completed safely');
    return {
      sessionId: recovered.sessionId,
      accessToken: recovered.accessToken,
      expiresIn: recovered.expiresIn,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.logout(sessionId);
  }

  private async loadCurrentUser(userId: string): Promise<CurrentUserResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: currentUserSelect,
    });
    const permissions = new Set<Permission>();
    for (const { role } of user.roles) {
      for (const { permission } of role.permissions) {
        permissions.add(permission.code as Permission);
      }
    }
    const detailInput: UserDetailRecord = {
      ...user,
      roles: user.roles.map(({ role }) => ({ role: { code: role.code } })),
    };
    return { ...toUserDetailResponse(detailInput), permissions: [...permissions] };
  }

  private unauthorizedFor(reason: string): HttpException {
    if (reason === 'account_inactive') return new HttpException('Account is not active', HttpStatus.FORBIDDEN);
    return new UnauthorizedException('Session is invalid or has expired');
  }
}