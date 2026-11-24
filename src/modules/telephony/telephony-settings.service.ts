import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TELEPHONY_CHANNEL, type TelephonyChannel } from './telephony.constants';

export interface TelephonyChannelConfig {
  channel: TelephonyChannel;
  isEnabled: boolean;
  serviceCode: string | null;
  accessNumber: string | null;
  sessionTtlSeconds: number;
  maxScreenChars: number;
  menuVersion: string;
  updatedAt: Date;
}

@Injectable()
export class TelephonySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async get(channel: TelephonyChannel): Promise<TelephonyChannelConfig> {
    const row = await this.prisma.telephonyChannelSetting.findUnique({ where: { channel } });
    if (!row) throw new NotFoundException('Telephony channel configuration not found');
    return row as TelephonyChannelConfig;
  }

  async requireEnabled(channel: TelephonyChannel): Promise<TelephonyChannelConfig> {
    const settings = await this.get(channel);
    if (!settings.isEnabled) throw new NotFoundException('This telephony channel is not enabled');
    return settings;
  }

  async update(
    channel: TelephonyChannel,
    data: Partial<
      Pick<TelephonyChannelConfig, 'isEnabled' | 'serviceCode' | 'accessNumber' | 'sessionTtlSeconds' | 'maxScreenChars' | 'menuVersion'>
    >,
    updatedById: string,
  ): Promise<TelephonyChannelConfig> {
    const envTtl =
      channel === TELEPHONY_CHANNEL.Ussd
        ? this.config.get<number>('ussd.sessionTtlSeconds', { infer: true })
        : this.config.get<number>('ivr.sessionTtlSeconds', { infer: true });
    const updated = await this.prisma.telephonyChannelSetting.update({
      where: { channel },
      data: {
        ...data,
        sessionTtlSeconds: data.sessionTtlSeconds ?? envTtl ?? 180,
        updatedById,
      },
    });
    return updated as TelephonyChannelConfig;
  }

  defaultMaxScreenChars(): number {
    return this.config.get<number>('ussd.maxScreenChars', { infer: true }) ?? 160;
  }
}