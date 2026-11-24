/*
 * TEST DOUBLES ONLY. No voice call is placed and no audio is played.
 */
import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  IvrGatewayAdapter,
  IvrGatewayResponse,
  NormalizedIvrRequest,
} from '../../src/modules/ivr/gateway/ivr-gateway.interfaces';

export const TEST_IVR_PROVIDER_ID = 'test-ivr';
export const IVR_SIGNATURE_HEADER = 'x-ivr-signature';

export class TestIvrGatewayAdapter implements IvrGatewayAdapter {
  readonly id = TEST_IVR_PROVIDER_ID;
  readonly isTestDouble = true;

  verify(
    context: { headers: Record<string, string | string[] | undefined>; body: unknown },
    secret: string,
  ): boolean {
    if (!secret) return true;
    const provided = context.headers[IVR_SIGNATURE_HEADER];
    const signature = Array.isArray(provided) ? provided[0] : provided;
    if (!signature) return false;
    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(context.body))
      .digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parse(body: unknown): NormalizedIvrRequest {
    if (!isTestIvrPayload(body)) {
      throw new BadRequestException('Invalid test IVR callback payload');
    }
    const digits = body.digits ?? '';
    return {
      providerSessionId: body.sessionId,
      requestId: body.callbackId,
      phoneNumber: body.phoneNumber,
      digits,
      callSid: body.callSid,
      isNewSession: digits.length === 0,
    };
  }

  format(response: IvrGatewayResponse): unknown {
    return {
      message: response.message,
      continueSession: response.continueSession,
      audioUnavailable: response.audioUnavailable ?? true,
      audioCommand: response.audioCommand,
      providerId: this.id,
    };
  }
}

export function signIvrBody(body: unknown, secret: string): string {
  return createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

function isTestIvrPayload(
  value: unknown,
): value is {
  sessionId: string;
  callbackId?: string;
  phoneNumber: string;
  digits?: string;
  callSid?: string;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sessionId === 'string' &&
    payload.sessionId.trim().length > 0 &&
    typeof payload.phoneNumber === 'string' &&
    payload.phoneNumber.trim().length > 0 &&
    (payload.callbackId === undefined || typeof payload.callbackId === 'string') &&
    (payload.digits === undefined || typeof payload.digits === 'string') &&
    (payload.callSid === undefined || typeof payload.callSid === 'string')
  );
}
