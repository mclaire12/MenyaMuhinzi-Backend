import { NestFactory } from '@nestjs/core';
import { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupApp } from './bootstrap/setup-app';
import { appConfig, swaggerConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  setupApp(app);

  const appCfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  const swaggerCfg = app.get<ConfigType<typeof swaggerConfig>>(swaggerConfig.KEY);

  await app.listen(appCfg.port);

  const baseUrl = `http://localhost:${appCfg.port}`;
  logger.log(`${appCfg.name} listening on ${baseUrl}/${appCfg.apiPrefix}/v${appCfg.apiVersion}`);
  if (swaggerCfg.enabled) {
    logger.log(`Swagger UI available at ${baseUrl}/${swaggerCfg.path}`);
  }
}

void bootstrap();
