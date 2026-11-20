import { isRwandanPhone, normalizeRwandanPhone } from './phone';

describe('Rwandan phone numbers', () => {
  it.each([
    ['0788123456', '+250788123456'],
    ['788123456', '+250788123456'],
    ['250788123456', '+250788123456'],
    ['+250 788 123 456', '+250788123456'],
    ['+250-722-123-456', '+250722123456'],
    ['(073) 123 4567', '+250731234567'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeRwandanPhone(input)).toBe(expected);
    expect(isRwandanPhone(normalizeRwandanPhone(input))).toBe(true);
  });

  it.each(['0781234', '0688123456', '+254712345678', '07881234567', 'not-a-number', ''])(
    'rejects %p',
    (input) => {
      expect(isRwandanPhone(normalizeRwandanPhone(input))).toBe(false);
    },
  );

  it('only accepts Rwandan mobile prefixes (072, 073, 078, 079)', () => {
    expect(isRwandanPhone('+250798123456')).toBe(true);
    expect(isRwandanPhone('+250758123456')).toBe(false);
  });
});
