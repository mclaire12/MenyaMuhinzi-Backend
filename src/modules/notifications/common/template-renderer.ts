export type VariableType = 'string' | 'number' | 'date';

export interface VariableDefinition {
  name: string;
  type: VariableType;
  required: boolean;
  description?: string;
  /** Longest accepted string value. Defaults to DEFAULT_MAX_VALUE_LENGTH. */
  maxLength?: number;
}

export type VariableValue = string | number | Date;

export const VARIABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const DEFAULT_MAX_VALUE_LENGTH = 200;

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Names of the placeholders ({{name}}) used in a text, without duplicates, in order of appearance. */
export function extractPlaceholders(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * Checks variable definitions against the template text. Returns problems; empty means valid.
 * Every placeholder must be defined, names must be unique and text must not contain stray braces.
 */
export function validateDefinitions(
  definitions: readonly VariableDefinition[],
  texts: readonly (string | null | undefined)[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (!VARIABLE_NAME_PATTERN.test(definition.name)) {
      problems.push(`Variable name "${definition.name}" is not valid`);
    }
    if (seen.has(definition.name)) problems.push(`Variable "${definition.name}" is defined twice`);
    seen.add(definition.name);
  }
  for (const text of texts) {
    if (!text) continue;
    for (const name of extractPlaceholders(text)) {
      if (!VARIABLE_NAME_PATTERN.test(name)) {
        problems.push(`Placeholder "{{${name}}}" is not valid`);
      } else if (!seen.has(name)) {
        problems.push(`Placeholder "{{${name}}}" has no variable definition`);
      }
    }
    if (text.replace(PLACEHOLDER, '').match(/\{\{|\}\}/)) {
      problems.push('Text contains an unmatched "{{" or "}}"');
    }
  }
  return [...new Set(problems)];
}

function formatDate(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Removes control characters so a value cannot add lines or hidden characters to a message. */
function clean(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

export interface ValidationOptions {
  /** Ignore values that have no definition (events pass one set of values to every channel). */
  allowExtra: boolean;
}

/** Validates values against the definitions before rendering. Returns problems; empty means valid. */
export function validateVariables(
  definitions: readonly VariableDefinition[],
  values: Readonly<Record<string, unknown>>,
  options: ValidationOptions,
): string[] {
  const problems: string[] = [];
  const known = new Set(definitions.map((definition) => definition.name));
  if (!options.allowExtra) {
    for (const name of Object.keys(values)) {
      if (!known.has(name)) problems.push(`Unknown variable "${name}"`);
    }
  }
  for (const definition of definitions) {
    const value = values[definition.name];
    if (value === undefined || value === null || value === '') {
      if (definition.required) problems.push(`Variable "${definition.name}" is required`);
      continue;
    }
    if (definition.type === 'string') {
      if (typeof value !== 'string') {
        problems.push(`Variable "${definition.name}" must be text`);
      } else if (clean(value).length > (definition.maxLength ?? DEFAULT_MAX_VALUE_LENGTH)) {
        problems.push(`Variable "${definition.name}" is too long`);
      }
    } else if (definition.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        problems.push(`Variable "${definition.name}" must be a number`);
      }
    } else if (
      !(value instanceof Date || typeof value === 'string') ||
      formatDate(value as Date | string) === null
    ) {
      problems.push(`Variable "${definition.name}" must be a date`);
    }
  }
  return problems;
}

/**
 * Replaces {{name}} placeholders with validated values in a single pass: text inside a value is
 * never interpreted again, and nothing is HTML-escaped or evaluated. Optional variables that are
 * absent render as an empty string. Call validateVariables first.
 */
export function renderText(
  text: string,
  definitions: readonly VariableDefinition[],
  values: Readonly<Record<string, unknown>>,
): string {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  return text.replace(PLACEHOLDER, (_match, name: string) => {
    const definition = byName.get(name);
    const value = values[name];
    if (!definition || value === undefined || value === null) return '';
    if (definition.type === 'number') return String(value);
    if (definition.type === 'date') return formatDate(value as Date | string) ?? '';
    return clean(String(value));
  });
}
