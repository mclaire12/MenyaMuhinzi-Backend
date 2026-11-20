import { basename, extname } from 'node:path';
import { KnowledgeSourceType } from '../../../generated/prisma/client';

export interface DetectedFile {
  sourceType: KnowledgeSourceType;
  mimeType: string;
  extension: string;
}

export class DocumentValidationError extends Error {}

const MIME_BY_TYPE: Partial<Record<KnowledgeSourceType, string>> = {
  [KnowledgeSourceType.PDF]: 'application/pdf',
  [KnowledgeSourceType.DOCX]:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  [KnowledgeSourceType.TXT]: 'text/plain',
  [KnowledgeSourceType.HTML]: 'text/html',
};

const EXTENSIONS: Partial<Record<KnowledgeSourceType, string[]>> = {
  [KnowledgeSourceType.PDF]: ['.pdf'],
  [KnowledgeSourceType.DOCX]: ['.docx'],
  [KnowledgeSourceType.TXT]: ['.txt'],
  [KnowledgeSourceType.HTML]: ['.html', '.htm'],
};

/** Formats the pipeline can extract text from in this phase. */
export const PROCESSABLE_TYPES: readonly KnowledgeSourceType[] = [
  KnowledgeSourceType.PDF,
  KnowledgeSourceType.DOCX,
  KnowledgeSourceType.TXT,
];

/** Executables and scripts are refused even when renamed. */
const EXECUTABLE_SIGNATURES: Buffer[] = [
  Buffer.from('MZ'),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  Buffer.from('#!'),
];

function startsWith(bytes: Buffer, signature: Buffer): boolean {
  return bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Keeps only the file name, without directories or control characters. */
export function sanitizeFilename(name: string): string {
  const cleaned = basename(name.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .trim()
    .slice(0, 255);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new DocumentValidationError('The file name is not valid');
  }
  return cleaned;
}

/**
 * Identifies the file from its content, then checks the extension and the declared type agree.
 * The MIME type sent by the client is not trusted.
 */
export function validateDocument(
  bytes: Buffer,
  filename: string,
  declaredType: KnowledgeSourceType,
  maxBytes: number,
): DetectedFile {
  if (bytes.length === 0) throw new DocumentValidationError('The file is empty');
  if (bytes.length > maxBytes) {
    throw new DocumentValidationError(`The file is larger than the ${maxBytes} byte limit`);
  }
  if (EXECUTABLE_SIGNATURES.some((signature) => startsWith(bytes, signature))) {
    throw new DocumentValidationError('Executable files are not accepted');
  }
  const extension = extname(filename).toLowerCase();

  let detected: KnowledgeSourceType;
  if (startsWith(bytes, Buffer.from('%PDF-'))) {
    detected = KnowledgeSourceType.PDF;
  } else if (startsWith(bytes, Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    if (extension !== '.docx') throw new DocumentValidationError('Only DOCX archives are accepted');
    detected = KnowledgeSourceType.DOCX;
  } else if (isUtf8Text(bytes)) {
    const head = bytes.subarray(0, 2048).toString('utf8').trimStart().toLowerCase();
    detected =
      ['.html', '.htm'].includes(extension) ||
      head.startsWith('<!doctype html') ||
      head.startsWith('<html')
        ? KnowledgeSourceType.HTML
        : KnowledgeSourceType.TXT;
  } else {
    throw new DocumentValidationError(
      'The file type is not supported. Upload PDF, DOCX, TXT or HTML',
    );
  }

  const expectedExtensions = EXTENSIONS[detected] ?? [];
  if (!expectedExtensions.includes(extension)) {
    throw new DocumentValidationError(
      `A ${detected} file must use the ${expectedExtensions.join(' or ')} extension`,
    );
  }
  const compatible =
    declaredType === detected ||
    (declaredType === KnowledgeSourceType.WEB_ARTICLE && detected === KnowledgeSourceType.HTML);
  if (!compatible && declaredType !== KnowledgeSourceType.OTHER) {
    throw new DocumentValidationError(
      `The file is ${detected}, but the source type is ${declaredType}`,
    );
  }
  return {
    sourceType: detected,
    mimeType: MIME_BY_TYPE[detected] ?? 'application/octet-stream',
    extension,
  };
}

/** Plain-text documents are decoded strictly; invalid UTF-8 is rejected rather than guessed. */
export function decodeText(bytes: Buffer): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return text.startsWith('\ufeff') ? text.slice(1) : text;
}
