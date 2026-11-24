import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { frontendConfig, oauthConfig } from '../../../config/configuration';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { GoogleOAuthStartDto } from '../dto/google-oauth.dto';
import { OAUTH_STATE_KEY_PREFIX, OAUTH_STATE_TTL_SECONDS } from './google-oauth.constants';

type OpenIdClient = typeof import('openid-client');
type OpenIdConfiguration = import('openid-client').Configuration;

export interface StoredGoogleOAuthState {
  nonce: string;
  codeVerifier: string;
  mode: 'login' | 'register';
  redirectUri: string;
  accountType?: string;
  phoneNumber?: string;
  fullName?: string;
  preferredLanguage?: string;
}

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  fullName?: string;
}

@Injectable()
export class GoogleOauthService implements OnModuleInit {
  private readonly logger = new Logger(GoogleOauthService.name);
  private openId?: OpenIdClient;
  private configuration?: OpenIdConfiguration;

  constructor(
    @Inject(oauthConfig.KEY) private readonly oauthSettings: ConfigType<typeof oauthConfig>,
    @Inject(frontendConfig.KEY) private readonly frontend: ConfigType<typeof frontendConfig>,
    private readonly redis: RedisService,
  ) {}

  private async client(): Promise<OpenIdClient> {
    if (!this.openId) this.openId = await import('openid-client');
    return this.openId;
  }

  async onModuleInit(): Promise<void> {
    if (!this.oauthSettings.googleEnabled) return;
    try {
      const oauth = await this.client();
      this.configuration = await oauth.discovery(
        new URL('https://accounts.google.com'),
        this.oauthSettings.googleClientId!,
        this.oauthSettings.googleClientSecret!,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Google OpenID discovery failed: ${message}`);
    }
  }

  isEnabled(): boolean {
    return this.oauthSettings.googleEnabled && Boolean(this.configuration);
  }

  status(): { enabled: boolean; clientId?: string } {
    return {
      enabled: this.isEnabled(),
      clientId: this.isEnabled() ? this.oauthSettings.googleClientId : undefined,
    };
  }

  private requireConfig(): OpenIdConfiguration {
    if (!this.isEnabled() || !this.configuration) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }
    return this.configuration;
  }

  assertRedirectUri(redirectUri: string): void {
    const configured = this.frontend.siteOrigin;
    if (!configured) return;
    const normalized = redirectUri.replace(/\/+$/, '');
    if (!normalized.startsWith(configured)) {
      throw new ServiceUnavailableException('OAuth redirect URI is not allowed');
    }
  }

  async createAuthorizationRequest(dto: GoogleOAuthStartDto): Promise<{ authorizationUrl: string }> {
    const oauth = await this.client();
    const config = this.requireConfig();
    this.assertRedirectUri(dto.redirectUri);

    const codeVerifier = oauth.randomPKCECodeVerifier();
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
    const state = oauth.randomState();
    const nonce = oauth.randomNonce();

    const record: StoredGoogleOAuthState = {
      nonce,
      codeVerifier,
      mode: dto.mode,
      redirectUri: dto.redirectUri,
      accountType: dto.accountType,
      phoneNumber: dto.phoneNumber,
      fullName: dto.fullName,
      preferredLanguage: dto.preferredLanguage,
    };
    await this.redis.setJson(`${OAUTH_STATE_KEY_PREFIX}${state}`, record, OAUTH_STATE_TTL_SECONDS);

    const url = oauth.buildAuthorizationUrl(config, {
      redirect_uri: dto.redirectUri,
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    return { authorizationUrl: url.href };
  }

  async verifyAuthorizationResponse(
    state: string,
    callbackUrl: string,
  ): Promise<{ identity: VerifiedGoogleIdentity; mode: StoredGoogleOAuthState['mode']; context: StoredGoogleOAuthState }> {
    const oauth = await this.client();
    const config = this.requireConfig();
    const key = `${OAUTH_STATE_KEY_PREFIX}${state}`;
    const stored = await this.redis.getJson<StoredGoogleOAuthState>(key);
    await this.redis.del(key);
    if (!stored) {
      throw new ServiceUnavailableException('OAuth state is invalid or has expired');
    }

    const tokens = await oauth.authorizationCodeGrant(config, new URL(callbackUrl), {
      pkceCodeVerifier: stored.codeVerifier,
      expectedState: state,
      expectedNonce: stored.nonce,
    });

    const claims = tokens.claims();
    if (!claims?.sub) {
      throw new ServiceUnavailableException('Google identity response is incomplete');
    }
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    const emailVerified = claims.email_verified === true;
    if (!email || !emailVerified) {
      throw new ServiceUnavailableException('A verified Google email is required to continue');
    }

    const fullName =
      typeof claims.name === 'string' && claims.name.trim()
        ? claims.name.trim()
        : stored.fullName;

    return {
      identity: { subject: claims.sub, email, emailVerified, fullName },
      mode: stored.mode,
      context: stored,
    };
  }
}