import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configNamespaces } from './configuration';
import { validateEnvironment } from './env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      load: configNamespaces,
      validate: validateEnvironment,
    }),
  ],
})
export class AppConfigModule {}
