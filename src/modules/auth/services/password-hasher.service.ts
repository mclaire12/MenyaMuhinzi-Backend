import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const ALGORITHM = 'scrypt';
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 1 };
/** Hash used to spend comparable time when the account does not exist. */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + Buffer.alloc(KEY_LENGTH).toString('base64');

function deriveKey(password: string, salt: Buffer, params: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem must exceed 128 * N * r bytes (32 MiB for the defaults).
    scrypt(password, salt, KEY_LENGTH, { ...params, maxmem: 256 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Memory-hard password hashing with Node's built-in scrypt.
 * Format: `scrypt$N$r$p$<salt base64>$<key base64>`; parameters are stored
 * with the hash so they can be raised later without invalidating old hashes.
 */
@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const { N, r, p } = DEFAULT_PARAMS;
    const key = await deriveKey(password, salt, { N, r, p });
    return [ALGORITHM, N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verify(password: string, stored: string | null | undefined): Promise<boolean> {
    const [algorithm, n, r, p, saltB64, keyB64] = (stored ?? DUMMY_HASH).split('$');
    if (algorithm !== ALGORITHM || !saltB64 || !keyB64) return false;

    const expected = Buffer.from(keyB64, 'base64');
    const actual = await deriveKey(password, Buffer.from(saltB64, 'base64'), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    return matches && stored !== null && stored !== undefined;
  }
}
