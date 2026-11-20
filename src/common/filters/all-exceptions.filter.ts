import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '../../generated/prisma/client';
import type { ErrorResponseDto } from '../dto/error-response.dto';

interface ResolvedError {
  statusCode: number;
  message: string | string[];
}

const PRISMA_ERROR_STATUS: Record<string, HttpStatus> = {
  P2002: HttpStatus.CONFLICT, // Unique constraint violation
  P2003: HttpStatus.CONFLICT, // Foreign key constraint violation
  P2025: HttpStatus.NOT_FOUND, // Record not found
};

/**
 * Converts every thrown error into the `ErrorResponseDto` envelope.
 * Internal details of unexpected errors are logged but never sent to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ url: string; method: string; id?: string }>();
    const response = ctx.getResponse<unknown>();

    const { statusCode, message } = this.resolve(exception);

    const body: ErrorResponseDto = {
      statusCode,
      error: this.reasonPhrase(statusCode),
      message,
      path: httpAdapter.getRequestUrl(request) as string,
      method: httpAdapter.getRequestMethod(request) as string,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${body.method} ${body.path} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    httpAdapter.reply(response, body, statusCode);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') return { statusCode, message: payload };
      const message = (payload as { message?: string | string[] }).message ?? exception.message;
      return { statusCode, message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const statusCode = PRISMA_ERROR_STATUS[exception.code];
      if (statusCode) {
        return {
          statusCode,
          message: statusCode === HttpStatus.NOT_FOUND ? 'Resource not found' : 'Resource conflict',
        };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred',
    };
  }

  private reasonPhrase(statusCode: number): string {
    const name = HttpStatus[statusCode] as string | undefined;
    if (!name) return 'Error';
    return name
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
