import { getQueueToken } from '@nestjs/bullmq';
import { Logger, type Provider } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ConnectionStateLogger } from '../../common/utils/connection-state-logger';
import { ALL_QUEUES } from './queue.constants';

export const QUEUE_CONNECTION_MONITOR = Symbol('QUEUE_CONNECTION_MONITOR');

/**
 * Routes BullMQ connection errors through the structured logger. Without an
 * `error` listener BullMQ prints raw stack traces on every reconnect attempt.
 * A factory (not a lifecycle hook) is used so listeners are attached as soon as
 * the queues are instantiated, before their first connection attempt fails.
 */
export const queueConnectionMonitorProvider: Provider = {
  provide: QUEUE_CONNECTION_MONITOR,
  inject: ALL_QUEUES.map((name) => getQueueToken(name)),
  useFactory: (...queues: Queue[]): true => {
    const logger = new Logger('Queues');
    for (const queue of queues) {
      const state = new ConnectionStateLogger(logger, `queue "${queue.name}"`);
      queue.on('error', (error) => state.error(error));
    }
    return true;
  },
};
