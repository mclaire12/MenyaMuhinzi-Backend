import { BadRequestException } from '@nestjs/common';
import { assertNoSecrets } from './safe-metadata';

describe('assertNoSecrets', () => {
  it('accepts descriptive, non-secret settings', () => {
    expect(() =>
      assertNoSecrets({ temperature: 0.2, region: 'eu', tags: ['rw', 'en'] }, 'metadata'),
    ).not.toThrow();
    expect(() => assertNoSecrets(undefined, 'metadata')).not.toThrow();
  });

  it.each(['apiKey', 'api_key', 'clientSecret', 'accessToken', 'password', 'Authorization'])(
    'rejects the %s key',
    (key) => {
      expect(() => assertNoSecrets({ nested: { [key]: 'x' } }, 'metadata')).toThrow(
        BadRequestException,
      );
    },
  );

  it.each([
    'sk-abcdefghijklmnopqrstuvwx',
    'AKIAABCDEFGHIJKLMNOP',
    'hf_abcdefghijklmnopqrstuvwxyz',
    'Bearer abc.def.ghi',
    '-----BEGIN RSA PRIVATE KEY-----',
  ])('rejects credential-looking values without echoing them', (value) => {
    try {
      assertNoSecrets({ endpoints: [{ note: value }] }, 'metadata');
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).not.toContain(value);
      expect((error as Error).message).toContain('metadata.endpoints[0].note');
    }
  });

  it('rejects oversized and deeply nested objects', () => {
    expect(() => assertNoSecrets({ blob: 'x'.repeat(20_000) }, 'metadata')).toThrow(
      BadRequestException,
    );
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };
    expect(() => assertNoSecrets(deep, 'metadata')).toThrow(BadRequestException);
  });
});
