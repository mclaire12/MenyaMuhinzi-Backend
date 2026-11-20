import { BadRequestException } from '@nestjs/common';

const SECRET_KEY =
  /(api[_-]?key|secret|token|password|passwd|credential|authorization|auth[_-]?header|private[_-]?key|access[_-]?key|bearer)/i;

const SECRET_VALUES: RegExp[] = [
  /^sk-[A-Za-z0-9_-]{16,}/,
  /^(AKIA|ASIA)[A-Z0-9]{16}$/,
  /^AIza[0-9A-Za-z_-]{30,}$/,
  /^hf_[A-Za-z0-9]{20,}$/,
  /^gh[pousr]_[A-Za-z0-9]{20,}$/,
  /^xox[abpr]-[A-Za-z0-9-]{10,}/,
  /^Bearer\s+\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const MAX_DEPTH = 6;
const MAX_SERIALIZED_LENGTH = 10_000;

/**
 * Rejects configuration objects that look like they carry credentials. Model and
 * configuration records must stay free of secrets; keys belong in a secret store and are
 * read by provider implementations, never through these APIs. The offending value is
 * never echoed back.
 */
export function assertNoSecrets(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  if (JSON.stringify(value).length > MAX_SERIALIZED_LENGTH) {
    throw new BadRequestException(`${field} is too large`);
  }
  walk(value, field, 0);
}

function walk(value: unknown, path: string, depth: number): void {
  if (depth > MAX_DEPTH) throw new BadRequestException(`${path} is nested too deeply`);
  if (typeof value === 'string') {
    if (SECRET_VALUES.some((pattern) => pattern.test(value.trim()))) {
      throw new BadRequestException(
        `${path} looks like a credential; secrets must not be stored here`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        throw new BadRequestException(
          `${path}.${key} is not allowed; secrets must not be stored in AI configuration`,
        );
      }
      walk(child, `${path}.${key}`, depth + 1);
    }
  }
}
