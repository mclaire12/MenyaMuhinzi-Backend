import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { webSessionConfig } from '../../../config/configuration';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class WebSessionCryptoError extends Error {
  constructor(readonly code: 'invalid_payload' | 'unknown_key_version') {
    super(code);
    this.name = 'WebSessionCryptoError';
  }
}

export interface EncryptedRefreshToken {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

/**
 * Session ids are random and stored only as HMAC-SHA256.
 * Refresh tokens are encrypted with AES-256-GCM under a key that is not a JWT secret.
 */
@Injectable()
export class WebSessionCryptoService {
  private readonly hashSecret: string;
  private readonly previousHashSecret: string | undefined;
  private readonly keys: Map<number, Buffer>;
  private readonly currentKeyVersion: number;

  constructor(@Inject(webSessionConfig.KEY) config: ConfigType<typeof webSessionConfig>) {
    const key = Buffer.from(config.encryptionKey, 'base64');
    if (key.length !== 32 || !Number.isInteger(config.encryptionKeyVersion) || config.encryptionKeyVersion < 1) {
      throw new Error('Web session encryption key is missing or invalid');
    }
    if (!config.hashSecret || config.hashSecret.length < 32) {
      throw new Error('Web session HMAC secret is missing or invalid');
    }
    this.hashSecret = config.hashSecret;
    this.previousHashSecret = config.previousHashSecret;
    this.currentKeyVersion = config.encryptionKeyVersion;
    this.keys = new Map([[config.encryptionKeyVersion, key]]);
  }

  generateSessionId(): string {
    return randomBytes(32).toString('base64url');
  }

  hashSessionId(sessionId: string): string {
    return this.hmac(sessionId, this.hashSecret);
  }

  /** Current hash first, then the previous secret while it is being rotated. */
  sessionHashes(sessionId: string): string[] {
    const hashes = [this.hashSessionId(sessionId)];
    if (this.previousHashSecret) hashes.push(this.hmac(sessionId, this.previousHashSecret));
    return hashes;
  }

  encryptRefreshToken(refreshToken: string): EncryptedRefreshToken {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.requireKey(this.currentKeyVersion), nonce);
    const ciphertext = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    if (authTag.length !== TAG_BYTES) throw new WebSessionCryptoError('invalid_payload');
    return { ciphertext, nonce, authTag, keyVersion: this.currentKeyVersion };
  }

  decryptRefreshToken(payload: EncryptedRefreshToken): string {
    const key = this.keys.get(payload.keyVersion);
    if (!key) throw new WebSessionCryptoError('unknown_key_version');
    if (payload.nonce.length !== NONCE_BYTES || payload.authTag.length !== TAG_BYTES) {
      throw new WebSessionCryptoError('invalid_payload');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, payload.nonce);
      decipher.setAuthTag(payload.authTag);
      return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new WebSessionCryptoError('invalid_payload');
    }
  }

  private requireKey(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) throw new WebSessionCryptoError('unknown_key_version');
    return key;
  }

  private hmac(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('hex');
  }
}
