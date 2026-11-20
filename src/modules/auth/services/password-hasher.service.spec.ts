import { PasswordHasher } from './password-hasher.service';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('never stores the plain-text password and salts every hash', async () => {
    const first = await hasher.hash('Umuhinzi2026');
    const second = await hasher.hash('Umuhinzi2026');

    expect(first).not.toContain('Umuhinzi2026');
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[^$]+\$[^$]+$/);
    expect(first).not.toEqual(second);
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const stored = await hasher.hash('Umuhinzi2026');

    await expect(hasher.verify('Umuhinzi2026', stored)).resolves.toBe(true);
    await expect(hasher.verify('umuhinzi2026', stored)).resolves.toBe(false);
  });

  it('rejects when there is no stored hash, even for the dummy password', async () => {
    await expect(hasher.verify('', null)).resolves.toBe(false);
    await expect(hasher.verify('anything', undefined)).resolves.toBe(false);
  });

  it('rejects malformed or foreign hash formats', async () => {
    await expect(hasher.verify('secret', '$2b$10$abcdefghijklmnopqrstuv')).resolves.toBe(false);
    await expect(hasher.verify('secret', 'scrypt$32768$8$1$')).resolves.toBe(false);
  });
});
