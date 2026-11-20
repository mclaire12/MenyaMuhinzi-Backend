import { KnowledgeSourceType } from '../../../generated/prisma/client';
import {
  decodeText,
  DocumentValidationError,
  sanitizeFilename,
  validateDocument,
} from './document-validation';

const MB = 1024 * 1024;
const pdf = Buffer.from('%PDF-1.4\n%fake');
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

describe('validateDocument', () => {
  it('detects PDF, DOCX and TXT from their content', () => {
    expect(validateDocument(pdf, 'guide.pdf', KnowledgeSourceType.PDF, MB)).toEqual({
      sourceType: KnowledgeSourceType.PDF,
      mimeType: 'application/pdf',
      extension: '.pdf',
    });
    expect(validateDocument(zip, 'guide.DOCX', KnowledgeSourceType.DOCX, MB).sourceType).toBe(
      KnowledgeSourceType.DOCX,
    );
    expect(
      validateDocument(
        Buffer.from('Inyanya zikunda izuba.'),
        'notes.txt',
        KnowledgeSourceType.TXT,
        MB,
      ).mimeType,
    ).toBe('text/plain');
  });

  it('accepts HTML for web articles', () => {
    const html = Buffer.from('<!DOCTYPE html><html><body>Hi</body></html>');
    expect(
      validateDocument(html, 'article.html', KnowledgeSourceType.WEB_ARTICLE, MB).sourceType,
    ).toBe(KnowledgeSourceType.HTML);
  });

  it('rejects empty and oversized files', () => {
    expect(() => validateDocument(Buffer.alloc(0), 'a.txt', KnowledgeSourceType.TXT, MB)).toThrow(
      'empty',
    );
    expect(() =>
      validateDocument(Buffer.alloc(11, 'a'), 'a.txt', KnowledgeSourceType.TXT, 10),
    ).toThrow('limit');
  });

  it('refuses executables even when renamed', () => {
    for (const bytes of [
      Buffer.from('MZ\x90\x00'),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
      Buffer.from('#!/bin/sh\nrm -rf /'),
    ]) {
      expect(() => validateDocument(bytes, 'guide.txt', KnowledgeSourceType.TXT, MB)).toThrow(
        'Executable',
      );
    }
  });

  it('rejects a declared type that does not match the content', () => {
    expect(() => validateDocument(pdf, 'guide.pdf', KnowledgeSourceType.DOCX, MB)).toThrow(
      'The file is PDF',
    );
  });

  it('rejects a wrong extension and non-DOCX archives', () => {
    expect(() => validateDocument(pdf, 'guide.txt', KnowledgeSourceType.PDF, MB)).toThrow(
      '.pdf extension',
    );
    expect(() => validateDocument(zip, 'archive.zip', KnowledgeSourceType.DOCX, MB)).toThrow(
      'Only DOCX',
    );
  });

  it('rejects binary content that is not a supported format', () => {
    expect(() =>
      validateDocument(Buffer.from([0x00, 0xff, 0x10, 0x80]), 'a.txt', KnowledgeSourceType.TXT, MB),
    ).toThrow(DocumentValidationError);
  });
});

describe('sanitizeFilename', () => {
  it('drops directories and unsafe characters', () => {
    expect(sanitizeFilename('../../etc/pa<ss>wd.txt')).toBe('passwd.txt');
    expect(sanitizeFilename('C:\\Users\\x\\guide.pdf')).toBe('guide.pdf');
  });

  it('rejects names that are empty after cleaning', () => {
    expect(() => sanitizeFilename('..')).toThrow(DocumentValidationError);
  });
});

describe('decodeText', () => {
  it('strips a byte-order mark and rejects invalid UTF-8', () => {
    expect(decodeText(Buffer.from('\ufeffAmashu', 'utf8'))).toBe('Amashu');
    expect(() => decodeText(Buffer.from([0xc3, 0x28]))).toThrow();
  });
});
