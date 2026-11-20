import { Injectable } from '@nestjs/common';
import { Language, NotificationChannel } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  ALL_CHANNELS,
  NotificationErrorCode,
  supportedChannelsForRoles,
} from '../notifications.constants';
import { NotificationProviderRegistry } from '../providers/notification-provider.registry';
import { NotificationSettingsService } from '../settings/notification-settings.service';

export interface Recipient {
  id: string;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  /** Account language. */
  preferredLanguage: Language;
  roles: string[];
}

export interface ChannelState {
  channel: NotificationChannel;
  /** The account type can use the channel at all. */
  supported: boolean;
  /** The channel can deliver now: switched on by an administrator and backed by a provider. */
  systemAvailable: boolean;
  hasAddress: boolean;
  /** supported && systemAvailable && hasAddress */
  available: boolean;
  reasonCode: NotificationErrorCode | null;
}

/**
 * Decides which channels a user can use. A channel is available only when the account type
 * supports it, an administrator enabled it, a provider is registered and the user has an
 * address for it. Basic-phone farmers are never required to have an email address.
 */
@Injectable()
export class NotificationChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationProviderRegistry,
    private readonly settings: NotificationSettingsService,
  ) {}

  async loadRecipient(userId: string): Promise<Recipient | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
        email: true,
        preferredLanguage: true,
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      preferredLanguage: user.preferredLanguage,
      roles: user.roles.map(({ role }) => role.code),
    };
  }

  async states(recipient: Recipient): Promise<Map<NotificationChannel, ChannelState>> {
    const enabled = await this.settings.enabledChannels();
    const supported = supportedChannelsForRoles(recipient.roles);
    return new Map(
      ALL_CHANNELS.map((channel) => [
        channel,
        this.state(channel, recipient, supported.includes(channel), enabled.has(channel)),
      ]),
    );
  }

  private state(
    channel: NotificationChannel,
    recipient: Recipient,
    supported: boolean,
    enabledByAdmin: boolean,
  ): ChannelState {
    const hasAddress = channel === NotificationChannel.EMAIL ? recipient.email !== null : true;
    const providerReady = this.registry.canDeliver(channel);
    let reasonCode: NotificationErrorCode | null = null;
    if (!supported) reasonCode = NotificationErrorCode.ChannelNotSupported;
    else if (!enabledByAdmin) reasonCode = NotificationErrorCode.ChannelDisabled;
    else if (!providerReady) reasonCode = NotificationErrorCode.ProviderNotConfigured;
    else if (!hasAddress) reasonCode = NotificationErrorCode.NoAddress;
    return {
      channel,
      supported,
      systemAvailable: enabledByAdmin && providerReady,
      hasAddress,
      available: reasonCode === null,
      reasonCode,
    };
  }
}
