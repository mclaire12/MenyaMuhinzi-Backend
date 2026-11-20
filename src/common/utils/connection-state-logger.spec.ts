import { Logger } from '@nestjs/common';
import { ConnectionStateLogger } from './connection-state-logger';

describe('ConnectionStateLogger', () => {
  let logger: jest.Mocked<Pick<Logger, 'log' | 'warn'>>;
  let state: ConnectionStateLogger;

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn() };
    state = new ConnectionStateLogger(logger as unknown as Logger, 'Redis');
  });

  it('logs a repeated error only once', () => {
    state.error(new Error('ECONNREFUSED'));
    state.error(new Error('ECONNREFUSED'));
    state.error(new Error('ECONNREFUSED'));

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('Redis unavailable: ECONNREFUSED');
  });

  it('logs again when the error changes', () => {
    state.error(new Error('ECONNREFUSED'));
    state.error(new Error('ETIMEDOUT'));

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('logs the same error again after a successful reconnection', () => {
    state.error(new Error('ECONNREFUSED'));
    state.ready();
    state.error(new Error('ECONNREFUSED'));

    expect(logger.log).toHaveBeenCalledWith('Connected to Redis');
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
