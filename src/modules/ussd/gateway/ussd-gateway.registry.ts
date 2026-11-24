import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { USSD_GATEWAY_PROVIDERS, type UssdGatewayAdapter } from './ussd-gateway.interfaces';

@Injectable()
export class UssdGatewayRegistry {
  constructor(@Inject(USSD_GATEWAY_PROVIDERS) private readonly providers: UssdGatewayAdapter[]) {}

  resolve(providerId?: string): UssdGatewayAdapter {
    if (this.providers.length === 0) {
      throw new NotFoundException('No USSD gateway provider is configured');
    }
    if (providerId) {
      const found = this.providers.find((provider) => provider.id === providerId);
      if (!found) throw new NotFoundException('Unknown USSD gateway provider');
      return found;
    }
    return this.providers[0];
  }

  list(): UssdGatewayAdapter[] {
    return [...this.providers];
  }
}