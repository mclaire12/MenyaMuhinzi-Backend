import { webSessionConfig } from '../../../config/configuration';
import { WebSessionCryptoError, WebSessionCryptoService } from './web-session-crypto.service';

const config = {
  hashSecret: 'web-session-hash-secret-0123456789abcd',
  previousHashSecret: undefined,
  encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
  encryptionKeyVersion: 1,
  idleTtl: '30m',
  absoluteTtl: '12h',
  lockTtlMs: 5000,
};

function service(overrides: Partial<typeof config> = {}): WebSessionCryptoService {
  return new WebSessionCryptoService({ ...config, ...overrides } as ReturnType<typeof webSessionConfig>);
}

describe('WebSessionCryptoService', () => {
  it('generates session ids that are not stored as their hash', () => {
    const crypto = service();
    const first = crypto.generateSessionId();
    const second = crypto.generateSessionId();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(crypto.hashSessionId(first)).toHaveLength(64);
    expect(crypto.hashSessionId(first)).not.toContain(first);
    expect(crypto.hashSessionId(first)).toBe(crypto.hashSessionId(first));
  });

  it('round-trips a refresh token with a 12-byte nonce and 16-byte tag', () => {
    const crypto = service();
    const encrypted = crypto.encryptRefreshToken('refresh-token-value');

    expect(encrypted.nonce).toHaveLength(12);
    expect(encrypted.authTag).toHaveLength(16);
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('refresh-token-value');
    expect(crypto.decryptRefreshToken(encrypted)).toBe('refresh-token-value');
  });

  it('rejects a tampered ciphertext or authentication tag', () => {
    const crypto = service();
    const encrypted = crypto.encryptRefreshToken('refresh-token-value');
    const tampered = Buffer.from(encrypted.ciphertext);
    tampered[0] ^= 0xff;

    expect(() => crypto.decryptRefreshToken({ ...encrypted, ciphertext: tampered })).toThrow(
      WebSessionCryptoError,
    );
    expect(() =>
      crypto.decryptRefreshToken({ ...encrypted, authTag: Buffer.alloc(16, 1) }),
    ).toThrow(WebSessionCryptoError);
  });

  it('rejects an unknown encryption key version', () => {
    const crypto = service();
    const encrypted = crypto.encryptRefreshToken('refresh-token-value');

    expect(() => crypto.decryptRefreshToken({ ...encrypted, keyVersion: 9 })).toThrow(
      expect.objectContaining({ code: 'unknown_key_version' }),
    );
  });

  it('fails to construct when the encryption key is not 32 bytes', () => {
    expect(() => service({ encryptionKey: Buffer.from('short').toString('base64') })).toThrow(
      /encryption key/i,
    );
  });
});
