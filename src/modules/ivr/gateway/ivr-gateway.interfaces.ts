import type { AudioPlaybackCommand } from '../../telephony/audio-provider.interfaces';

export const IVR_GATEWAY_PROVIDERS = Symbol('IVR_GATEWAY_PROVIDERS');

export interface NormalizedIvrRequest {
  providerSessionId: string;
  /** Stable provider callback/event identifier used for retry idempotency, when available. */
  requestId?: string;
  callSid?: string;
  phoneNumber: string;
  digits: string;
  isNewSession: boolean;
}

export interface IvrGatewayResponse {
  message: string;
  audioUnavailable?: boolean;
  audioCommand?: AudioPlaybackCommand;
  continueSession: boolean;
}

export interface IvrGatewayAdapter {
  readonly id: string;
  readonly isTestDouble?: boolean;
  verify(
    context: {
      headers: Record<string, string | string[] | undefined>;
      body: unknown;
    },
    secret: string,
  ): boolean;
  parse(body: unknown): NormalizedIvrRequest;
  format(response: IvrGatewayResponse): unknown;
}
