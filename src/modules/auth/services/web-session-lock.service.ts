import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { webSessionConfig } from '../../../config/configuration';
import { RedisService } from '../../../infrastructure/redis/redis.service';

const REFRESH_RESULT_TTL_SECONDS = 30;

export interface WebSessionRefreshResult {
  fromVersion: number;
  sessionId: string;
  accessToken: string;
  expiresIn: number;
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface WebSessionLock {
  key: string;
  owner: string;
}

export type WebSessionLockResult =
  | { acquired: true; lock: WebSessionLock }
  | { acquired: false; reason: 'contended' | 'unavailable' };

/**
 * Coordinates a future refresh across NestJS instances.
 * A failed acquire must stop the caller; this service does not rotate tokens or cache access tokens.
 */
@Injectable()
export class WebSessionLockService {
  constructor(
    private readonly redis: RedisService,
    @Inject(webSessionConfig.KEY) private readonly config: ConfigType<typeof webSessionConfig>,
  ) {}

  /** `sessionHash` is the stored HMAC, never the raw session id. */
  async acquire(sessionHash: string): Promise<WebSessionLockResult> {
    const client = this.redis.raw;
    if (client.status !== 'ready') return { acquired: false, reason: 'unavailable' };
    const lock = { key: `mm:web-session:lock:${sessionHash}`, owner: randomUUID() };
    try {
      const result = await client.set(lock.key, lock.owner, 'PX', this.config.lockTtlMs, 'NX');
      if (result !== 'OK') return { acquired: false, reason: 'contended' };
      return { acquired: true, lock };
    } catch {
      return { acquired: false, reason: 'unavailable' };
    }
  }

  /** Deletes the lock only when this owner still holds it. */
  resultKey(sessionHash: string): string {
    return `mm:web-session:refresh-result:${sessionHash}`;
  }

  async storeRefreshResult(sessionHash: string, result: WebSessionRefreshResult): Promise<void> {
    await this.redis.setJson(this.resultKey(sessionHash), result, REFRESH_RESULT_TTL_SECONDS);
  }

  async readRefreshResult(sessionHash: string): Promise<WebSessionRefreshResult | null> {
    return this.redis.getJson<WebSessionRefreshResult>(this.resultKey(sessionHash));
  }

  async waitForRefreshResult(
    sessionHash: string,
    fromVersion: number,
    maxWaitMs = 4_000,
  ): Promise<WebSessionRefreshResult | null> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const result = await this.readRefreshResult(sessionHash);
      if (result && result.fromVersion === fromVersion) return result;
      await delay(50);
    }
    return null;
  }

  async release(lock: WebSessionLock): Promise<boolean> {
    const client = this.redis.raw;
    if (client.status !== 'ready') return false;
    try {
      const result = await client.eval(RELEASE_SCRIPT, 1, lock.key, lock.owner);
      return result === 1;
    } catch {
      return false;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
