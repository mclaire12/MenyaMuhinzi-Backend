import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { ConfigType } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { parseDuration } from '../../common/utils/duration';
import { jwtConfig, rateLimitConfig } from '../../config/configuration';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { WebSessionController } from './web-session.controller';
import { AuthService } from './auth.service';
import { AUTH_RATE_LIMIT_KEY } from './decorators/auth.decorators';
import { AccessTokenGuard } from './guards/access-token.guard';
import { AuthorizationGuard } from './guards/authorization.guard';
import { TokenService } from './services/token.service';
import { WebSessionCryptoService } from './services/web-session-crypto.service';
import { WebSessionLockService } from './services/web-session-lock.service';
import { WebSessionAuthService } from './services/web-session-auth.service';
import { WebSessionService } from './services/web-session.service';
import { BffGuard } from './guards/bff.guard';
import { PasswordResetDeliveryStoreService } from './delivery/password-reset-delivery-store.service';
import { PasswordResetDeliveryService } from './delivery/password-reset-delivery.service';
import { PasswordResetWorker } from './delivery/password-reset.worker';
import { GoogleOauthService } from './oauth/google-oauth.service';
import { GoogleWebSessionAuthService } from './oauth/google-web-session-auth.service';

const reflector = new Reflector();

@Module({
  imports: [
    RedisModule,
    UsersModule,
    NotificationsModule,
    JwtModule.registerAsync({
      inject: [jwtConfig.KEY],
      useFactory: (jwt: ConfigType<typeof jwtConfig>) => ({
        secret: jwt.accessSecret,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: Math.floor(parseDuration(jwt.accessExpiresIn) / 1000),
          issuer: jwt.issuer,
          audience: jwt.audience,
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: jwt.issuer,
          audience: jwt.audience,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [rateLimitConfig.KEY],
      useFactory: (limits: ConfigType<typeof rateLimitConfig>) => ({
        throttlers: [
          { name: 'default', ttl: limits.ttlSeconds * 1000, limit: limits.max },
          {
            name: 'auth',
            ttl: limits.ttlSeconds * 1000,
            limit: limits.authMax,
            skipIf: (context) =>
              !reflector.getAllAndOverride<boolean>(AUTH_RATE_LIMIT_KEY, [
                context.getHandler(),
                context.getClass(),
              ]),
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController, WebSessionController],
  providers: [
    AuthService,
    TokenService,
    WebSessionCryptoService,
    WebSessionLockService,
    WebSessionService,
    WebSessionAuthService,
    GoogleOauthService,
    GoogleWebSessionAuthService,
    PasswordResetDeliveryStoreService,
    PasswordResetDeliveryService,
    PasswordResetWorker,
    BffGuard,
    // Order matters: rate limiting, then authentication, then authorization.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
  exports: [TokenService, WebSessionService],
})
export class AuthModule {}
