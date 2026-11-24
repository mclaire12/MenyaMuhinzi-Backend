import { BadRequestException } from '@nestjs/common';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Prevents spreadsheet formula injection when a cell starts with a formula character. */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text =
    value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : String(value);
  text = text.replace(/\r\n|\r|\n/g, ' ');
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(sanitizeCsvCell).join(','),
    ...rows.map((row) => row.map(sanitizeCsvCell).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function assertCsvRowLimit(rowCount: number, maxRows: number): void {
  if (rowCount > maxRows) {
    throw new BadRequestException(
      `CSV export is limited to ${maxRows} rows; narrow the filters or date range.`,
    );
  }
}
