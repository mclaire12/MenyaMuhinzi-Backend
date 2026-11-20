import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../../generated/prisma/client';
import { IN_APP_PROVIDER_ID } from '../notifications.constants';
import {
  NOTIFICATION_PROVIDERS,
  type NotificationProvider,
} from './notification-provider.interfaces';

export interface ChannelProviderInfo {
  /** IN_APP is delivered by the platform and needs no provider. */
  providerRequired: boolean;
  providerRegistered: boolean;
  providerId: string | null;
  isTestDouble: boolean;
}

/** Looks up the registered provider for a channel. With no providers bound, only IN_APP works. */
@Injectable()
export class NotificationProviderRegistry {
  constructor(@Inject(NOTIFICATION_PROVIDERS) private readonly providers: NotificationProvider[]) {}

  forChannel(channel: NotificationChannel): NotificationProvider | null {
    if (channel === NotificationChannel.IN_APP) return null;
    return this.providers.find((provider) => provider.channels.includes(channel)) ?? null;
  }

  /** True when the channel can actually deliver: the platform inbox, or a registered provider. */
  canDeliver(channel: NotificationChannel): boolean {
    return channel === NotificationChannel.IN_APP || this.forChannel(channel) !== null;
  }

  describe(channel: NotificationChannel): ChannelProviderInfo {
    if (channel === NotificationChannel.IN_APP) {
      return {
        providerRequired: false,
        providerRegistered: true,
        providerId: IN_APP_PROVIDER_ID,
        isTestDouble: false,
      };
    }
    const provider = this.forChannel(channel);
    return {
      providerRequired: true,
      providerRegistered: provider !== null,
      providerId: provider?.id ?? null,
      isTestDouble: provider?.isTestDouble === true,
    };
  }
}
