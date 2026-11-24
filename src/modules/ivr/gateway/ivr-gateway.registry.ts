import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IVR_GATEWAY_PROVIDERS, type IvrGatewayAdapter } from './ivr-gateway.interfaces';

@Injectable()
export class IvrGatewayRegistry {
  constructor(@Inject(IVR_GATEWAY_PROVIDERS) private readonly providers: IvrGatewayAdapter[]) {}

  resolve(providerId?: string): IvrGatewayAdapter {
    if (this.providers.length === 0) {
      throw new NotFoundException('No IVR gateway provider is configured');
    }
    if (providerId) {
      const match = this.providers.find((provider) => provider.id === providerId);
      if (!match) throw new NotFoundException('Unknown IVR gateway provider');
      return match;
    }
    return this.providers[0];
  }
}