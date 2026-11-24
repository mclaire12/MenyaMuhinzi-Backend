/*
 * TEST DOUBLES ONLY. Nothing here sends a USSD prompt and no telecom network request is made.
 */
import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  NormalizedUssdRequest,
  UssdGatewayAdapter,
  UssdGatewayResponse,
} from '../../src/modules/ussd/gateway/ussd-gateway.interfaces';

export const TEST_USSD_PROVIDER_ID = 'test-ussd';
export const USSD_SIGNATURE_HEADER = 'x-ussd-signature';

export class TestUssdGatewayAdapter implements UssdGatewayAdapter {
  readonly id = TEST_USSD_PROVIDER_ID;
  readonly isTestDouble = true;

  verify(
    context: { headers: Record<string, string | string[] | undefined>; body: unknown },
    secret: string,
  ): boolean {
    if (!secret) return true;
    const provided = context.headers[USSD_SIGNATURE_HEADER];
    const signature = Array.isArray(provided) ? provided[0] : provided;
    if (!signature) return false;
    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(context.body))
      .digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parse(body: unknown): NormalizedUssdRequest {
    if (!isTestUssdPayload(body)) {
      throw new BadRequestException('Invalid test USSD callback payload');
    }
    const text = body.text ?? '';
    return {
      providerSessionId: body.sessionId,
      requestId: body.callbackId,
      phoneNumber: body.phoneNumber,
      text,
      serviceCode: body.serviceCode,
      isNewSession: text.length === 0,
    };
  }

  format(response: UssdGatewayResponse): unknown {
    return {
      message: response.message,
      continueSession: response.continueSession,
      providerId: this.id,
    };
  }
}

export function signUssdBody(body: unknown, secret: string): string {
  return createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

function isTestUssdPayload(
  value: unknown,
): value is {
  sessionId: string;
  callbackId?: string;
  phoneNumber: string;
  text?: string;
  serviceCode?: string;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sessionId === 'string' &&
    payload.sessionId.trim().length > 0 &&
    typeof payload.phoneNumber === 'string' &&
    payload.phoneNumber.trim().length > 0 &&
    (payload.callbackId === undefined || typeof payload.callbackId === 'string') &&
    (payload.text === undefined || typeof payload.text === 'string') &&
    (payload.serviceCode === undefined || typeof payload.serviceCode === 'string')
  );
}
