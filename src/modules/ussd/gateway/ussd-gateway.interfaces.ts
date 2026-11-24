/**
 * USSD aggregator adapters. Nothing is sent to a telecom network unless a real provider is bound
 * to USSD_GATEWAY_PROVIDERS.
 */
export const USSD_GATEWAY_PROVIDERS = Symbol('USSD_GATEWAY_PROVIDERS');

export interface NormalizedUssdRequest {
  providerSessionId: string;
  /** Stable provider callback/event identifier used for retry idempotency, when available. */
  requestId?: string;
  phoneNumber: string;
  text: string;
  serviceCode?: string;
  isNewSession: boolean;
}

export interface UssdGatewayResponse {
  message: string;
  /** When false the provider should close the USSD session. */
  continueSession: boolean;
}

export interface UssdGatewayAdapter {
  readonly id: string;
  readonly isTestDouble?: boolean;
  verify(
    context: {
      headers: Record<string, string | string[] | undefined>;
      body: unknown;
    },
    secret: string,
  ): boolean;
  parse(body: unknown): NormalizedUssdRequest;
  format(response: UssdGatewayResponse): unknown;
}