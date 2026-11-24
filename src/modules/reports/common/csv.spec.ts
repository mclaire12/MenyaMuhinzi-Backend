import { BadRequestException } from '@nestjs/common';
import { assertCsvRowLimit, sanitizeCsvCell, toCsv } from './csv';

describe('CSV helpers', () => {
  it('prefixes formula-like cells', () => {
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvCell('+cmd')).toBe("'+cmd");
    expect(sanitizeCsvCell('-1')).toBe("'-1");
    expect(sanitizeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('quotes commas and escapes quotes', () => {
    expect(sanitizeCsvCell('a,b')).toBe('"a,b"');
    expect(sanitizeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('builds a CRLF CSV document', () => {
    expect(toCsv(['name', 'count'], [['Tomato', 2]])).toBe('name,count\r\nTomato,2\r\n');
  });

  it('refuses oversized exports', () => {
    expect(() => assertCsvRowLimit(101, 100)).toThrow(BadRequestException);
    expect(() => assertCsvRowLimit(100, 100)).not.toThrow();
  });
});
