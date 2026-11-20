import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { parseDuration } from '../../common/utils/duration';
import { jwtConfig, rateLimitConfig } from '../../config/configuration';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_RATE_LIMIT_KEY } from './decorators/auth.decorators';
import { AccessTokenGuard } from './guards/access-token.guard';
import { AuthorizationGuard } from './guards/authorization.guard';
import { TokenService } from './services/token.service';

const reflector = new Reflector();

@Module({
  imports: [
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
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    // Order matters: rate limiting, then authentication, then authorization.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
  exports: [TokenService],
})
export class AuthModule {}
