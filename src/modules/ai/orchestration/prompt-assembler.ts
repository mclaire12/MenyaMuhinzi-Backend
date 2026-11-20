import { Injectable } from '@nestjs/common';
import type { AssembledPrompt, PromptAssembler, PromptAssemblyInput } from './ai.interfaces';

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** Placeholder names in a template, in order of first use. */
export function extractVariables(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(PLACEHOLDER)) names.add(match[1]);
  return [...names];
}

/**
 * Joins prompt versions and active safety policies into a system prompt and substitutes
 * {{variable}} placeholders. Unknown placeholders are left empty and reported, never guessed.
 */
@Injectable()
export class TemplatePromptAssembler implements PromptAssembler {
  assemble(input: PromptAssemblyInput): AssembledPrompt {
    const missing = new Set<string>();
    const render = (content: string) =>
      content.replace(PLACEHOLDER, (_, name: string) => {
        const value = input.variables[name];
        if (value === undefined) {
          missing.add(name);
          return '';
        }
        return value;
      });

    const sections = input.parts.map((part) => render(part.content).trim()).filter(Boolean);
    if (input.policies.length > 0) {
      const rules = input.policies.map((policy) => {
        const lines = [policy.instructions.trim()];
        for (const restriction of policy.restrictions) lines.push(`- ${restriction}`);
        return lines.join('\n');
      });
      sections.push(`Safety policies:\n${rules.join('\n\n')}`);
    }

    return {
      system: sections.join('\n\n'),
      messages: [...input.history, { role: 'user', content: input.question }],
      promptVersionIds: input.parts.map((part) => part.promptVersionId),
      policyVersionIds: input.policies.map((policy) => policy.policyVersionId),
      missingVariables: [...missing],
    };
  }
}
