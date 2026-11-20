import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

export interface SwaggerOptions {
  title: string;
  version: string;
  path: string;
}

export function setupSwagger(app: INestApplication, options: SwaggerOptions): void {
  const config = new DocumentBuilder()
    .setTitle(options.title)
    .setDescription(
      'REST API for MenyaMuhinzi, the AI-powered agricultural e-learning platform for Rwandan farmers.',
    )
    .setVersion(options.version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ErrorResponseDto],
  });

  SwaggerModule.setup(options.path, app, document, {
    jsonDocumentUrl: `${options.path}/json`,
    swaggerOptions: { persistAuthorization: true },
  });
}
