import { Logger } from '@nestjs/common';
import { describeError } from './describe-error';

/**
 * Logs connection errors only when they change, so reconnect loops against an
 * unavailable service do not flood the logs.
 */
export class ConnectionStateLogger {
  private lastError?: string;

  constructor(
    private readonly logger: Logger,
    private readonly target: string,
  ) {}

  ready(): void {
    this.lastError = undefined;
    this.logger.log(`Connected to ${this.target}`);
  }

  error(error: unknown): void {
    const description = describeError(error);
    if (description === this.lastError) return;
    this.lastError = description;
    this.logger.warn(`${this.target} unavailable: ${description}`);
  }
}
