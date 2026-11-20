import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { normalizeRwandanPhone } from '../../common/utils/phone';
import { authConfig } from '../../config/configuration';
import {
  FarmerType,
  LoginAttemptOutcome,
  Prisma,
  TokenRevocationReason,
  UserStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { QueueName } from '../../infrastructure/queue/queue.constants';
import { RoleCode } from '../roles/rbac.constants';
import type { CurrentUserResponseDto } from '../users/dto/user-response.dto';
import { NotificationEvent } from '../notifications/events/notification-events';
import { NotificationPublisher } from '../notifications/publishing/notification-publisher.service';
import {
  toUserDetailResponse,
  toUserResponse,
  userDetailSelect,
  userSummarySelect,
} from '../users/user.mapper';
import { UserProvisioningService } from '../users/user-provisioning.service';
import { accountStatusMessage } from './account-status';
import type { AuthenticatedUser, ClientContext } from './auth.types';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth-request.dto';
import type {
  AuthTokensResponseDto,
  ForgotPasswordResponseDto,
  RegistrationResponseDto,
} from './dto/auth-response.dto';
import { PasswordHasher } from './services/password-hasher.service';
import { TokenService } from './services/token.service';

export const PASSWORD_RESET_JOB = 'auth.password-reset';

const INVALID_CREDENTIALS = 'Invalid phone number, email or password';
const FORGOT_PASSWORD_MESSAGE =
  'If an active account matches, password reset instructions have been sent.';

export interface PasswordResetJob {
  userId: string;
  channel: 'sms' | 'email';
  destination: string;
  token: string;
  expiresAt: string;
  language: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly provisioning: UserProvisioningService,
    private readonly publisher: NotificationPublisher,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
    @InjectQueue(QueueName.Notifications) private readonly notifications: Queue,
  ) {}

  async register(dto: RegisterDto): Promise<RegistrationResponseDto> {
    const isFacilitator = dto.accountType === RoleCode.Facilitator;
    const requiresApproval = isFacilitator || this.config.farmerRequiresApproval;

    const { userId, accountRequestId } = await this.provisioning.provision({
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      email: dto.email,
      password: dto.password,
      preferredLanguage: dto.preferredLanguage,
      roles: [dto.accountType],
      status: requiresApproval ? UserStatus.PENDING : UserStatus.ACTIVE,
      location: dto.location,
      farmer: isFacilitator
        ? undefined
        : { farmerType: FarmerType.SMARTPHONE, farmerCategory: dto.farmerCategory },
      facilitator: isFacilitator ? dto.facilitator : undefined,
      accountRequest: requiresApproval ? { requestedRole: dto.accountType } : undefined,
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: userSummarySelect,
    });
    return {
      user: toUserResponse(user),
      requiresApproval,
      accountRequestId,
      message: requiresApproval
        ? 'Registration received. An administrator will review your account.'
        : 'Registration complete. You can now sign in.',
    };
  }

  async login(dto: LoginDto, client: ClientContext): Promise<AuthTokensResponseDto> {
    const email = dto.email;
    const user = await this.prisma.user.findFirst({
      where: { deletedAt: null, email },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        lockedUntil: true,
        passwordChangedAt: true,
        roles: { select: { role: { select: { code: true } } } },
      },
    });

    if (!user) {
      await this.hasher.verify(dto.password, null); // equalise timing with the found-user path
      await this.recordAttempt(email, LoginAttemptOutcome.UNKNOWN_IDENTIFIER, client);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.recordAttempt(email, LoginAttemptOutcome.ACCOUNT_LOCKED, client, user.id);
      throw new HttpException(
        'Too many failed sign-in attempts; the account is temporarily locked. Try again later.',
        HttpStatus.LOCKED,
      );
    }

    if (!user.passwordHash) {
      await this.hasher.verify(dto.password, null);
      await this.recordAttempt(email, LoginAttemptOutcome.NO_PASSWORD, client, user.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!(await this.hasher.verify(dto.password, user.passwordHash))) {
      await this.registerFailedPassword(user.id);
      await this.recordAttempt(email, LoginAttemptOutcome.INVALID_PASSWORD, client, user.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // Status is only revealed once the password has been verified.
    if (user.status !== UserStatus.ACTIVE) {
      await this.recordAttempt(email, LoginAttemptOutcome.ACCOUNT_NOT_ACTIVE, client, user.id);
      throw new ForbiddenException(accountStatusMessage(user.status));
    }

    const profile = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      select: userSummarySelect,
    });
    await this.recordAttempt(email, LoginAttemptOutcome.SUCCESS, client, user.id);

    const { refreshTokenId: _id, ...tokens } = await this.tokens.issue(
      {
        id: user.id,
        roles: user.roles.map(({ role }) => role.code as RoleCode),
        passwordChangedAt: user.passwordChangedAt,
      },
      client,
    );
    return { ...tokens, user: toUserResponse(profile) };
  }

  async refresh(refreshToken: string, client: ClientContext): Promise<AuthTokensResponseDto> {
    const { userId, ...tokens } = await this.tokens.rotate(refreshToken, client);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: userSummarySelect,
    });
    return { ...tokens, user: toUserResponse(user) };
  }

  async logout(actor: AuthenticatedUser, dto: LogoutDto): Promise<void> {
    if (dto.allDevices) {
      await this.tokens.revokeAllForUser(actor.id, TokenRevocationReason.LOGOUT);
      return;
    }
    const revoked = await this.tokens.revokeByToken(actor.id, dto.refreshToken as string);
    if (!revoked)
      throw new BadRequestException('Refresh token does not belong to the current user');
  }

  async me(actor: AuthenticatedUser): Promise<CurrentUserResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: userDetailSelect,
    });
    return { ...toUserDetailResponse(user), permissions: actor.permissions };
  }

  async changePassword(actor: AuthenticatedUser, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { passwordHash: true },
    });
    if (!(await this.hasher.verify(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('The new password must be different from the current password');
    }
    await this.setPassword(actor.id, dto.newPassword);
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    client: ClientContext,
  ): Promise<ForgotPasswordResponseDto> {
    const identifier = normalizeIdentifier(dto.identifier);
    const user = await this.prisma.user.findFirst({
      where: { deletedAt: null, status: UserStatus.ACTIVE, ...identifierWhere(identifier) },
      select: { id: true, phoneNumber: true, email: true, preferredLanguage: true },
    });

    // The response is identical whether or not an account exists.
    if (!user) return { message: FORGOT_PASSWORD_MESSAGE };

    const token = this.tokens.generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + this.config.passwordResetTtlMinutes * 60_000);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.tokens.hashToken(token),
          expiresAt,
          requestedIp: client.ipAddress,
        },
      }),
    ]);

    // Delivery (SMS for phone-only users, otherwise email) is handled by a
    // notifications processor in a later phase.
    const job: PasswordResetJob = {
      userId: user.id,
      channel: identifier.kind === 'email' && user.email ? 'email' : 'sms',
      destination: identifier.kind === 'email' && user.email ? user.email : user.phoneNumber,
      token,
      expiresAt: expiresAt.toISOString(),
      language: user.preferredLanguage,
    };
    await this.notifications.add(PASSWORD_RESET_JOB, job, {
      removeOnComplete: true,
      removeOnFail: 100,
    });

    return this.config.exposeResetToken
      ? { message: FORGOT_PASSWORD_MESSAGE, resetToken: token, expiresAt }
      : { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.tokens.hashToken(dto.token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { status: true } },
      },
    });
    if (!stored || stored.usedAt || stored.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Password reset token is invalid or has expired');
    }
    if (stored.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(accountStatusMessage(stored.user.status));
    }

    const { count } = await this.prisma.passwordResetToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0)
      throw new BadRequestException('Password reset token is invalid or has expired');

    await this.setPassword(stored.userId, dto.newPassword);
  }

  /** Updates the password, clears lockout and ends every existing session. */
  private async setPassword(userId: string, password: string): Promise<void> {
    const passwordHash = await this.hasher.hash(password);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.tokens.revokeAllForUser(userId, TokenRevocationReason.PASSWORD_CHANGED);
    // The message never contains the password; essential security notifications ignore opt-outs.
    await this.publisher.notifyEvent(
      NotificationEvent.PasswordChanged,
      userId,
      {},
      { entity: { type: 'user', id: userId } },
    );
  }

  private async registerFailedPassword(userId: string): Promise<void> {
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (failedLoginAttempts >= this.config.maxFailedLogins) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + this.config.lockoutMinutes * 60_000),
        },
      });
      this.logger.warn(
        `User ${userId} locked after ${failedLoginAttempts} failed sign-in attempts`,
      );
    }
  }

  private async recordAttempt(
    identifier: string,
    outcome: LoginAttemptOutcome,
    client: ClientContext,
    userId?: string,
  ): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: {
        identifier: identifier.slice(0, 254),
        outcome,
        userId,
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
      },
    });
  }
}

interface NormalizedIdentifier {
  kind: 'email' | 'phone';
  value: string;
}

export function normalizeIdentifier(raw: string): NormalizedIdentifier {
  const trimmed = raw.trim();
  return trimmed.includes('@')
    ? { kind: 'email', value: trimmed.toLowerCase() }
    : { kind: 'phone', value: normalizeRwandanPhone(trimmed) };
}

function identifierWhere(identifier: NormalizedIdentifier): Prisma.UserWhereInput {
  return identifier.kind === 'email'
    ? { email: identifier.value }
    : { phoneNumber: identifier.value };
}
