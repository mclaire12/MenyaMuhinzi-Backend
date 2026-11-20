import { Injectable } from '@nestjs/common';
import { AiValidationStatus } from '../../../generated/prisma/client';
import type {
  ResponseValidationInput,
  ResponseValidationResult,
  ResponseValidator,
  ValidationCheck,
} from './ai.interfaces';

export const ValidationCode = {
  EmptyResponse: 'EMPTY_RESPONSE',
  ResponseTooLong: 'RESPONSE_TOO_LONG',
  MissingSources: 'MISSING_SOURCE_REFERENCES',
  UnknownReference: 'UNKNOWN_SOURCE_REFERENCE',
  UnsupportedQuantitativeClaim: 'UNSUPPORTED_QUANTITATIVE_CLAIM',
  PolicyTriggered: 'POLICY_TRIGGERED',
  EscalationRequired: 'HUMAN_ESCALATION_REQUIRED',
} as const;

export const MAX_RESPONSE_CHARS = 20_000;
const CITATION = /\[(\d{1,3})\]/g;
/** Doses, rates and concentrations, e.g. "20 ml", "2 kg/ha", "5%". */
const QUANTITY =
  /\b\d+(?:[.,]\d+)?\s?(?:ml|l|litres?|liters?|g|kg|mg|%|ppm|kg\/ha|l\/ha|g\/l|ml\/l)\b/i;

/**
 * Basic, deterministic checks. They catch empty or malformed output, missing or invented
 * citations, uncited quantities and policy keywords. They are not a guarantee that the
 * content is agronomically correct or safe.
 */
@Injectable()
export class BasicResponseValidator implements ResponseValidator {
  readonly name = 'basic-rules-v1';

  validate(input: ResponseValidationInput): ResponseValidationResult {
    const checks: ValidationCheck[] = [];
    const warnings = new Set<string>();
    let failed = false;
    let escalate = false;
    const fail = (check: string, code: string, detail: string) => {
      checks.push({ check, result: 'FAIL', detail });
      warnings.add(code);
      failed = true;
    };

    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (content.length === 0) {
      fail('STRUCTURE', ValidationCode.EmptyResponse, 'The response is empty.');
    } else if (content.length > MAX_RESPONSE_CHARS) {
      fail(
        'STRUCTURE',
        ValidationCode.ResponseTooLong,
        `Longer than ${MAX_RESPONSE_CHARS} characters.`,
      );
    } else {
      checks.push({ check: 'STRUCTURE', result: 'PASS' });
    }

    const cited = [...content.matchAll(CITATION)].map((match) => Number(match[1]));
    const unknown = cited.filter((n) => n < 1 || n > input.references.length);
    if (unknown.length > 0) {
      fail(
        'CITATIONS',
        ValidationCode.UnknownReference,
        `Cites [${[...new Set(unknown)].join('], [')}] but only ${input.references.length} sources were provided.`,
      );
    } else {
      checks.push({ check: 'CITATIONS', result: 'PASS' });
    }

    if (input.requireSourceReferences) {
      if (input.references.length === 0 || cited.length === 0) {
        fail(
          'SOURCE_REFERENCES',
          ValidationCode.MissingSources,
          input.references.length === 0
            ? 'The assistant requires approved sources but none were retrieved.'
            : 'The response does not cite any of the provided sources.',
        );
      } else {
        checks.push({ check: 'SOURCE_REFERENCES', result: 'PASS' });
      }
    }

    if (QUANTITY.test(content) && cited.length === 0) {
      checks.push({
        check: 'UNSUPPORTED_CLAIMS',
        result: 'WARN',
        detail: 'Contains quantities or doses without a source citation.',
      });
      warnings.add(ValidationCode.UnsupportedQuantitativeClaim);
    } else {
      checks.push({ check: 'UNSUPPORTED_CLAIMS', result: 'PASS' });
    }

    const haystack = `${input.question}\n${content}`.toLowerCase();
    for (const policy of input.policies) {
      const hit = policy.triggerKeywords.find((keyword) =>
        haystack.includes(keyword.trim().toLowerCase()),
      );
      if (!hit) continue;
      checks.push({
        check: 'SAFETY_POLICY',
        result: 'WARN',
        policyVersionId: policy.policyVersionId,
        detail: `Policy ${policy.policyCode} matched "${hit}".`,
      });
      warnings.add(ValidationCode.PolicyTriggered);
      if (policy.requiresEscalation) {
        escalate = true;
        warnings.add(ValidationCode.EscalationRequired);
      }
    }

    const status = failed
      ? AiValidationStatus.FAILED
      : warnings.size > 0
        ? AiValidationStatus.WARNING
        : AiValidationStatus.PASSED;
    return {
      validator: this.name,
      status,
      checks,
      warningCodes: [...warnings],
      requiresEscalation: escalate,
    };
  }
}
