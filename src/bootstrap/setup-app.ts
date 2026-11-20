import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { appConfig, swaggerConfig } from '../config/configuration';
import { setupSwagger } from './swagger';

/**
 * Applies the HTTP conventions shared by the running server and the e2e tests:
 * `/api/v1` routing, CORS, global validation and Swagger.
 */
export function setupApp(app: NestExpressApplication): void {
  const appCfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  const swaggerCfg = app.get<ConfigType<typeof swaggerConfig>>(swaggerConfig.KEY);

  app.disable('x-powered-by');

  app.setGlobalPrefix(appCfg.apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: appCfg.apiVersion });

  app.enableCors({
    origin: appCfg.corsOrigins.includes('*') ? true : appCfg.corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  );

  app.enableShutdownHooks();

  if (swaggerCfg.enabled) {
    setupSwagger(app, {
      title: appCfg.name,
      version: appCfg.apiVersion,
      path: swaggerCfg.path,
    });
  }
}
