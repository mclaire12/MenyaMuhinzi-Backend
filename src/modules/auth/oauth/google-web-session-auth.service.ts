import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { normalizeRwandanPhone } from '../../../common/utils/phone';
import { authConfig } from '../../../config/configuration';
import { FarmerType, Language, UserStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { RoleCode } from '../../roles/rbac.constants';
import { UserProvisioningService } from '../../users/user-provisioning.service';
import { userSummarySelect, toUserResponse } from '../../users/user.mapper';
import { accountStatusMessage } from '../account-status';
import type { ClientContext } from '../auth.types';
import type { GoogleOAuthCompleteDto } from '../dto/google-oauth.dto';
import type { WebSessionCreatedResponseDto } from '../dto/web-session.dto';
import { WebSessionService } from '../services/web-session.service';
import { SELF_REGISTRATION_ROLES, type SelfRegistrationRole } from '../dto/auth-request.dto';
import { GOOGLE_OAUTH_PROVIDER } from './google-oauth.constants';
import { GoogleOauthService } from './google-oauth.service';

const UNLINKED_GOOGLE =
  'No MenyaMuhinzi account is linked to this Google identity. Register with Google or sign in with email.';

@Injectable()
export class GoogleWebSessionAuthService {
  constructor(
    private readonly google: GoogleOauthService,
    private readonly prisma: PrismaService,
    private readonly provisioning: UserProvisioningService,
    private readonly sessions: WebSessionService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async start(dto: import('../dto/google-oauth.dto').GoogleOAuthStartDto) {
    if (dto.mode === 'register') {
      if (!dto.accountType || !SELF_REGISTRATION_ROLES.includes(dto.accountType)) {
        throw new BadRequestException('Choose farmer or facilitator registration before Google sign-in');
      }
      if (!dto.phoneNumber?.trim()) {
        throw new BadRequestException('Enter your phone number before continuing with Google');
      }
    }
    return this.google.createAuthorizationRequest(dto);
  }

  async complete(
    dto: GoogleOAuthCompleteDto,
    client: ClientContext,
  ): Promise<{ body: WebSessionCreatedResponseDto; sessionId: string }> {
    const { identity, mode, context } = await this.google.verifyAuthorizationResponse(
      dto.state,
      dto.callbackUrl,
    );

    const linked = await this.prisma.userOAuthIdentity.findUnique({
      where: { provider_subject: { provider: GOOGLE_OAUTH_PROVIDER, subject: identity.subject } },
      select: { userId: true },
    });

    const userId = linked
      ? linked.userId
      : mode === 'login'
        ? null
        : await this.registerWithGoogle(identity, context);

    if (!userId) {
      throw new UnauthorizedException(UNLINKED_GOOGLE);
    }

    const profile = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { ...userSummarySelect, passwordChangedAt: true },
    });
    if (!profile) throw new UnauthorizedException(UNLINKED_GOOGLE);

    const roleCodes = profile.roles.map(({ role }) => role.code as RoleCode);
    if (roleCodes.includes(RoleCode.Admin)) {
      throw new ForbiddenException('Administrator accounts must sign in with email and password');
    }
    if (roleCodes.includes(RoleCode.BasicPhoneFarmer) && !roleCodes.includes(RoleCode.SmartphoneFarmer)) {
      throw new ForbiddenException('Basic-phone farmer accounts cannot use Google sign-in');
    }

    if (profile.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(accountStatusMessage(profile.status));
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });

    const { sessionId } = await this.sessions.create({
      userId,
      passwordChangedAt: profile.passwordChangedAt,
      client,
    });
    const stored = await this.sessions.findBySessionId(sessionId);
    if (!stored) throw new UnauthorizedException('Unable to create a web session');

    return {
      sessionId,
      body: {
        user: toUserResponse(profile),
        idleExpiresAt: stored.idleExpiresAt,
        absoluteExpiresAt: stored.absoluteExpiresAt,
      },
    };
  }

  private async registerWithGoogle(
    identity: { subject: string; email: string; fullName?: string },
    context: {
      accountType?: string;
      phoneNumber?: string;
      fullName?: string;
      preferredLanguage?: string;
    },
  ): Promise<string> {
    const accountType = context.accountType as SelfRegistrationRole | undefined;
    if (!accountType || !SELF_REGISTRATION_ROLES.includes(accountType)) {
      throw new BadRequestException('Registration type is required for Google sign-up');
    }
    if (!context.phoneNumber) {
      throw new BadRequestException('Phone number is required for Google sign-up');
    }

    const phoneNumber = normalizeRwandanPhone(context.phoneNumber);
    const email = identity.email.toLowerCase();

    const existingEmail = await this.prisma.user.findFirst({
      where: { deletedAt: null, email },
      select: { id: true, passwordHash: true },
    });
    if (existingEmail) {
      const linked = await this.prisma.userOAuthIdentity.findFirst({
        where: { userId: existingEmail.id, provider: GOOGLE_OAUTH_PROVIDER },
      });
      if (linked) return existingEmail.id;
      throw new ConflictException(
        'An account with this email already exists. Sign in with your password instead of Google.',
      );
    }

    const isFacilitator = accountType === RoleCode.Facilitator;
    const requiresApproval = isFacilitator || this.config.farmerRequiresApproval;
    const fullName = (context.fullName ?? identity.fullName ?? email.split('@')[0]!).slice(0, 150);
    const preferredLanguage = (context.preferredLanguage as Language | undefined) ?? Language.rw;

    const { userId } = await this.provisioning.provision({
      fullName,
      phoneNumber,
      email,
      preferredLanguage,
      roles: [accountType],
      status: requiresApproval ? UserStatus.PENDING : UserStatus.ACTIVE,
      farmer: isFacilitator
        ? undefined
        : { farmerType: FarmerType.SMARTPHONE },
      facilitator: isFacilitator
        ? {
            professionalTitle: 'Facilitator',
            organization: 'Pending profile',
            contactEmail: email,
          }
        : undefined,
      accountRequest: requiresApproval ? { requestedRole: accountType } : undefined,
    });

    try {
      await this.prisma.userOAuthIdentity.create({
        data: {
          userId,
          provider: GOOGLE_OAUTH_PROVIDER,
          subject: identity.subject,
          email,
        },
      });
    } catch (error) {
      const linked = await this.prisma.userOAuthIdentity.findUnique({
        where: { provider_subject: { provider: GOOGLE_OAUTH_PROVIDER, subject: identity.subject } },
        select: { userId: true },
      });
      if (linked?.userId === userId) return userId;
      throw error;
    }

    if (requiresApproval) {
      throw new ForbiddenException(accountStatusMessage(UserStatus.PENDING));
    }

    return userId;
  }
}