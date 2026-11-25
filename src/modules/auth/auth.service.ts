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
import { EmailVerificationService } from '../users/email-verification.service';
import { UserProvisioningService } from '../users/user-provisioning.service';
import { accountStatusMessage, EMAIL_NOT_VERIFIED } from './account-status';
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
import { PasswordResetDeliveryStoreService } from './delivery/password-reset-delivery-store.service';
import { PasswordHasher } from './services/password-hasher.service';
import { TokenService } from './services/token.service';

export const PASSWORD_RESET_JOB = 'auth.password-reset';

const INVALID_CREDENTIALS = 'Invalid phone number, email or password';
const FORGOT_PASSWORD_MESSAGE =
  'If an active account matches, password reset instructions have been sent.';

/** BullMQ payload: reference only — no reset token, destination, or secrets. */
export interface PasswordResetJob {
  deliveryId: string;
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
    private readonly passwordResetDeliveries: PasswordResetDeliveryStoreService,
    private readonly emailVerification: EmailVerificationService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
    @InjectQueue(QueueName.Notifications) private readonly notifications: Queue,
  ) {}

  async register(dto: RegisterDto): Promise<RegistrationResponseDto> {
    const isFacilitator = dto.accountType === RoleCode.Facilitator;
    const requiresApproval = isFacilitator;

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
    // Smartphone farmers verify their email straight away; facilitators only after approval.
    const verificationEmailSent = requiresApproval
      ? false
      : (await this.emailVerification.issue(userId, 'registration')).emailSent;
    return {
      user: toUserResponse(user),
      requiresApproval,
      requiresEmailVerification: true,
      verificationEmailSent,
      accountRequestId,
      message: requiresApproval
        ? 'Registration received. An administrator will review your account; after approval you will receive an email to verify your address.'
        : verificationEmailSent
          ? 'Registration complete. Check your email to verify your account before signing in.'
          : 'Registration complete, but the verification email could not be sent. Request a new verification email.',
    };
  }

  /** Validates email/password and applies the same ACTIVE-account rules as `login`, without issuing JWTs. */
  async authenticateActiveLogin(
    dto: LoginDto,
    client: ClientContext,
  ): Promise<{ userId: string; passwordChangedAt: Date | null }> {
    const { identifier, ...authenticated } = await this.verifyLoginCredentials(dto, client);
    await this.recordAttempt(identifier, LoginAttemptOutcome.SUCCESS, client, authenticated.userId);
    return authenticated;
  }

  async login(dto: LoginDto, client: ClientContext): Promise<AuthTokensResponseDto> {
    const authenticated = await this.authenticateActiveLogin(dto, client);
    const profile = await this.prisma.user.findUniqueOrThrow({
      where: { id: authenticated.userId },
      select: userSummarySelect,
    });

    const { refreshTokenId: _id, ...tokens } = await this.tokens.issue(
      {
        id: authenticated.userId,
        roles: profile.roles.map(({ role }) => role.code as RoleCode),
        passwordChangedAt: authenticated.passwordChangedAt,
      },
      client,
    );
    return { ...tokens, user: toUserResponse(profile) };
  }

  private async verifyLoginCredentials(
    dto: LoginDto,
    client: ClientContext,
  ): Promise<{ userId: string; passwordChangedAt: Date | null; identifier: string }> {
    // `identifier` accepts an email or a phone number; `email` is the legacy field name.
    const identifierInput = dto.identifier ?? dto.email ?? '';
    const identifier = normalizeIdentifier(identifierInput);
    const identifierValue = identifier.value;
    const user = await this.prisma.user.findFirst({
      where: { deletedAt: null, ...identifierWhere(identifier) },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        emailVerifiedAt: true,
        lockedUntil: true,
        passwordChangedAt: true,
      },
    });

    if (!user) {
      await this.hasher.verify(dto.password, null);
      await this.recordAttempt(identifierValue, LoginAttemptOutcome.UNKNOWN_IDENTIFIER, client);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.recordAttempt(identifierValue, LoginAttemptOutcome.ACCOUNT_LOCKED, client, user.id);
      throw new HttpException(
        'Too many failed sign-in attempts; the account is temporarily locked. Try again later.',
        HttpStatus.LOCKED,
      );
    }

    if (!user.passwordHash) {
      await this.hasher.verify(dto.password, null);
      await this.recordAttempt(identifierValue, LoginAttemptOutcome.NO_PASSWORD, client, user.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!(await this.hasher.verify(dto.password, user.passwordHash))) {
      await this.registerFailedPassword(user.id);
      await this.recordAttempt(identifierValue, LoginAttemptOutcome.INVALID_PASSWORD, client, user.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.status !== UserStatus.ACTIVE) {
      await this.recordAttempt(identifierValue, LoginAttemptOutcome.ACCOUNT_NOT_ACTIVE, client, user.id);
      throw new ForbiddenException(accountStatusMessage(user.status));
    }

    if (!user.emailVerifiedAt) {
      await this.recordAttempt(identifierValue, LoginAttemptOutcome.ACCOUNT_NOT_ACTIVE, client, user.id);
      throw new ForbiddenException(EMAIL_NOT_VERIFIED);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return { userId: user.id, passwordChangedAt: user.passwordChangedAt, identifier: identifierValue };
  }

  async refresh(refreshToken: string, client: ClientContext): Promise<AuthTokensResponseDto> {
    const { userId, refreshTokenId: _rtid, ...tokens } = await this.tokens.rotate(refreshToken, client);
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

  async verifyEmail(token: string, code: string): Promise<void> {
    await this.emailVerification.verify(token, code);
  }

  async resendEmailVerification(rawIdentifier: string): Promise<{ message: string }> {
    const identifier = normalizeIdentifier(rawIdentifier);
    return this.emailVerification.resend(
      identifier.kind === 'email' ? { email: identifier.value } : { phoneNumber: identifier.value },
    );
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    client: ClientContext,
  ): Promise<ForgotPasswordResponseDto> {
    const identifier = normalizeIdentifier(dto.identifier ?? dto.email ?? '');
    const user = await this.prisma.user.findFirst({
      where: { deletedAt: null, status: UserStatus.ACTIVE, ...identifierWhere(identifier) },
      select: { id: true, phoneNumber: true, email: true, preferredLanguage: true },
    });

    // The response is identical whether or not an account exists.
    if (!user) return { message: FORGOT_PASSWORD_MESSAGE };

    const token = this.tokens.generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + this.config.passwordResetTtlMinutes * 60_000);
    // Every account has a personal email now, so the reset link goes there whichever identifier
    // was typed; SMS remains only for legacy accounts without an email.
    const channel: 'sms' | 'email' = user.email ? 'email' : 'sms';
    const destination = user.email ?? user.phoneNumber;

    await this.passwordResetDeliveries.invalidatePendingForUser(user.id);

    const createdToken = await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.tokens.hashToken(token),
          expiresAt,
          requestedIp: client.ipAddress,
        },
        select: { id: true },
      });
    });

    const { deliveryId } = await this.passwordResetDeliveries.create({
      passwordResetTokenId: createdToken.id,
      userId: user.id,
      channel,
      destination,
      language: user.preferredLanguage,
      resetToken: token,
      expiresAt,
    });

    const job: PasswordResetJob = { deliveryId };
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
