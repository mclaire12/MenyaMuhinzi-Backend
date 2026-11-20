import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Language,
  NotificationCategory,
  NotificationChannel,
  type NotificationCategoryPreference,
  type NotificationChannelPreference,
  type NotificationPreference,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  NotificationChannelsService,
  type ChannelState,
  type Recipient,
} from '../channels/notification-channels.service';
import { isValidTimeZone, type QuietHours } from '../common/quiet-hours';
import type {
  NotificationPreferencesResponseDto,
  UpdateNotificationPreferencesDto,
} from '../dto/preference.dto';
import {
  ALL_CATEGORIES,
  DEFAULT_TIME_ZONE,
  NotificationAuditAction,
  NotificationAuditEntity,
  NotificationErrorMessage,
  type NotificationErrorCode,
} from '../notifications.constants';
import { NotificationSettingsService } from '../settings/notification-settings.service';

interface RawPreferences {
  preference: NotificationPreference | null;
  channels: NotificationChannelPreference[];
  categories: NotificationCategoryPreference[];
}

/** What the publisher needs to know about a user's choices. */
export interface EffectivePreferences {
  language: Language;
  quietHours: QuietHours;
  nonEssentialEnabled: boolean;
  /** Channels the user switched off. Everything else is on by default. */
  disabledChannels: Set<NotificationChannel>;
  disabledCategories: Set<NotificationCategory>;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly channels: NotificationChannelsService,
    private readonly settings: NotificationSettingsService,
  ) {}

  async get(userId: string): Promise<NotificationPreferencesResponseDto> {
    const recipient = await this.requireRecipient(userId);
    const states = await this.channels.states(recipient);
    return this.present(recipient, await this.effective(recipient), await this.raw(userId), states);
  }

  /** Effective choices for the publisher; unset values fall back to defaults. */
  async effective(recipient: Recipient): Promise<EffectivePreferences> {
    const raw = await this.raw(recipient.id);
    return {
      language: raw.preference?.preferredLanguage ?? recipient.preferredLanguage,
      quietHours: {
        enabled: raw.preference?.quietHoursEnabled ?? false,
        start: raw.preference?.quietHoursStart ?? null,
        end: raw.preference?.quietHoursEnd ?? null,
        timeZone: raw.preference?.timeZone ?? DEFAULT_TIME_ZONE,
      },
      nonEssentialEnabled: raw.preference?.nonEssentialEnabled ?? true,
      disabledChannels: new Set(
        raw.channels.filter((row) => !row.enabled).map((row) => row.channel),
      ),
      disabledCategories: new Set(
        raw.categories.filter((row) => !row.enabled).map((row) => row.category),
      ),
    };
  }

  async update(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
    actor: AuthenticatedUser,
  ): Promise<NotificationPreferencesResponseDto> {
    const recipient = await this.requireRecipient(userId);
    const states = await this.channels.states(recipient);
    const current = await this.raw(userId);

    if (dto.timeZone !== undefined && !isValidTimeZone(dto.timeZone)) {
      throw new BadRequestException(
        'timeZone must be a valid IANA time zone such as Africa/Kigali',
      );
    }

    this.assertUnique(
      dto.channels?.map((item) => item.channel),
      'channels',
    );
    for (const item of dto.channels ?? []) {
      const state = states.get(item.channel) as ChannelState;
      if (!state.supported) {
        throw new BadRequestException(`${item.channel} is not supported for your account type`);
      }
      if (item.channel === NotificationChannel.IN_APP && !item.enabled) {
        throw new BadRequestException('The in-app inbox cannot be turned off');
      }
      if (item.enabled && !state.available) {
        throw new BadRequestException(
          `${item.channel} cannot be turned on: ${NotificationErrorMessage[state.reasonCode as NotificationErrorCode]}`,
        );
      }
    }

    this.assertUnique(
      dto.categories?.map((item) => item.category),
      'categories',
    );
    for (const item of dto.categories ?? []) {
      if (!item.enabled && (await this.settings.categoryPolicy(item.category)).isEssential) {
        throw new BadRequestException(
          `${item.category} notifications are essential and cannot be turned off`,
        );
      }
    }

    const quiet = dto.quietHours;
    const nextStart = quiet?.start ?? current.preference?.quietHoursStart ?? null;
    const nextEnd = quiet?.end ?? current.preference?.quietHoursEnd ?? null;
    if (quiet?.enabled) {
      if (!nextStart || !nextEnd)
        throw new BadRequestException('Quiet hours need both start and end');
      if (nextStart === nextEnd)
        throw new BadRequestException('Quiet hours start and end must differ');
    }

    await this.prisma.$transaction(async (tx) => {
      const preferenceData = {
        ...(dto.preferredLanguage !== undefined
          ? { preferredLanguage: dto.preferredLanguage }
          : {}),
        ...(dto.timeZone !== undefined ? { timeZone: dto.timeZone } : {}),
        ...(dto.nonEssentialEnabled !== undefined
          ? { nonEssentialEnabled: dto.nonEssentialEnabled }
          : {}),
        ...(quiet
          ? { quietHoursEnabled: quiet.enabled, quietHoursStart: nextStart, quietHoursEnd: nextEnd }
          : {}),
      };
      await tx.notificationPreference.upsert({
        where: { userId },
        update: preferenceData,
        create: { userId, ...preferenceData },
      });
      for (const item of dto.channels ?? []) {
        await tx.notificationChannelPreference.upsert({
          where: { userId_channel: { userId, channel: item.channel } },
          update: { enabled: item.enabled },
          create: { userId, channel: item.channel, enabled: item.enabled },
        });
      }
      for (const item of dto.categories ?? []) {
        await tx.notificationCategoryPreference.upsert({
          where: { userId_category: { userId, category: item.category } },
          update: { enabled: item.enabled },
          create: { userId, category: item.category, enabled: item.enabled },
        });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: NotificationAuditAction.PreferencesUpdated,
          entityType: NotificationAuditEntity.Preferences,
          entityId: userId,
          details: { fields: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.get(userId);
  }

  private async present(
    recipient: Recipient,
    effective: EffectivePreferences,
    raw: RawPreferences,
    states: Map<NotificationChannel, ChannelState>,
  ): Promise<NotificationPreferencesResponseDto> {
    const channels = [...states.values()]
      .filter((state) => state.supported)
      .map((state) => {
        const enabled =
          state.channel === NotificationChannel.IN_APP ||
          !effective.disabledChannels.has(state.channel);
        return {
          channel: state.channel,
          enabled,
          available: state.available,
          active: enabled && state.available,
          locked: state.channel === NotificationChannel.IN_APP,
          unavailableReasonCode: state.reasonCode,
          unavailableReason: state.reasonCode ? NotificationErrorMessage[state.reasonCode] : null,
        };
      });
    const categories = await Promise.all(
      ALL_CATEGORIES.map(async (category) => {
        const policy = await this.settings.categoryPolicy(category);
        return {
          category,
          enabled: policy.isEssential || !effective.disabledCategories.has(category),
          isEssential: policy.isEssential,
          locked: policy.isEssential,
        };
      }),
    );
    return {
      accountTypes: recipient.roles,
      accountLanguage: recipient.preferredLanguage,
      preferredLanguage: raw.preference?.preferredLanguage ?? null,
      effectiveLanguage: effective.language,
      timeZone: effective.quietHours.timeZone,
      quietHours: {
        enabled: effective.quietHours.enabled,
        start: effective.quietHours.start,
        end: effective.quietHours.end,
      },
      nonEssentialEnabled: effective.nonEssentialEnabled,
      channels,
      categories,
    };
  }

  private async raw(userId: string): Promise<RawPreferences> {
    const [preference, channels, categories] = await this.prisma.$transaction([
      this.prisma.notificationPreference.findUnique({ where: { userId } }),
      this.prisma.notificationChannelPreference.findMany({ where: { userId } }),
      this.prisma.notificationCategoryPreference.findMany({ where: { userId } }),
    ]);
    return { preference, channels, categories };
  }

  private async requireRecipient(userId: string): Promise<Recipient> {
    const recipient = await this.channels.loadRecipient(userId);
    if (!recipient) throw new NotFoundException('User not found');
    return recipient;
  }

  private assertUnique(values: string[] | undefined, field: string): void {
    if (values && new Set(values).size !== values.length) {
      throw new BadRequestException(`${field} must not repeat an entry`);
    }
  }
}
