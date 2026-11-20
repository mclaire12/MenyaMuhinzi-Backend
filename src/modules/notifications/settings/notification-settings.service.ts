import { ConflictException, Injectable, BadRequestException } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationChannel,
  Prisma,
  type NotificationCategorySetting,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { RoleCode } from '../../roles/rbac.constants';
import type {
  CategorySettingResponseDto,
  ChannelSettingResponseDto,
  UpdateCategorySettingDto,
  UpdateChannelSettingDto,
} from '../dto/settings.dto';
import {
  ALL_CATEGORIES,
  ALL_CHANNELS,
  LOCKED_ESSENTIAL_CATEGORIES,
  NotificationAuditAction,
  NotificationAuditEntity,
  supportedChannelsForRoles,
} from '../notifications.constants';
import { NotificationProviderRegistry } from '../providers/notification-provider.registry';

export interface CategoryPolicy {
  category: NotificationCategory;
  isEssential: boolean;
  isActive: boolean;
  allowedChannels: NotificationChannel[];
}

const ACCOUNT_TYPES: Record<string, RoleCode[]> = Object.fromEntries(
  ALL_CHANNELS.map((channel) => [
    channel,
    Object.values(RoleCode).filter((role) => supportedChannelsForRoles([role]).includes(channel)),
  ]),
);

/** Administrator policy: which channels each category may use, and which channels are switched on. */
@Injectable()
export class NotificationSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: NotificationProviderRegistry,
  ) {}

  // ----------------------------------------------------------------- categories

  async listCategories(): Promise<CategorySettingResponseDto[]> {
    const rows = await this.prisma.notificationCategorySetting.findMany();
    const byCategory = new Map(rows.map((row) => [row.category, row]));
    return ALL_CATEGORIES.map((category) => this.toCategory(category, byCategory.get(category)));
  }

  /** The policy for a category; seeded rows win, defaults apply when a row is missing. */
  async categoryPolicy(category: NotificationCategory): Promise<CategoryPolicy> {
    const row = await this.prisma.notificationCategorySetting.findUnique({ where: { category } });
    return this.toPolicy(category, row ?? undefined);
  }

  async updateCategory(
    category: NotificationCategory,
    dto: UpdateCategorySettingDto,
    actor: AuthenticatedUser,
  ): Promise<CategorySettingResponseDto> {
    const locked = LOCKED_ESSENTIAL_CATEGORIES.includes(category);
    if (locked && (dto.isEssential === false || dto.isActive === false)) {
      throw new ConflictException(
        `${category} notifications are essential and cannot be made optional or switched off`,
      );
    }
    if (dto.allowedChannels && !dto.allowedChannels.includes(NotificationChannel.IN_APP)) {
      throw new BadRequestException(
        'allowedChannels must include IN_APP, the inbox that records every notification',
      );
    }
    const current = await this.categoryPolicy(category);
    const updated = await this.prisma.$transaction(async (tx) => {
      const data = {
        isEssential: dto.isEssential ?? current.isEssential,
        isActive: dto.isActive ?? current.isActive,
        allowedChannels: dto.allowedChannels ?? current.allowedChannels,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        updatedById: actor.id,
      };
      const row = await tx.notificationCategorySetting.upsert({
        where: { category },
        update: data,
        create: { category, ...data },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: NotificationAuditAction.CategoryUpdated,
          entityType: NotificationAuditEntity.CategorySetting,
          entityId: category,
          details: {
            from: {
              isEssential: current.isEssential,
              isActive: current.isActive,
              allowedChannels: current.allowedChannels,
            },
            to: {
              isEssential: row.isEssential,
              isActive: row.isActive,
              allowedChannels: row.allowedChannels,
            },
          },
        },
        tx,
      );
      return row;
    });
    return this.toCategory(category, updated);
  }

  // ------------------------------------------------------------------- channels

  async listChannels(): Promise<ChannelSettingResponseDto[]> {
    const rows = await this.prisma.notificationChannelSetting.findMany();
    const byChannel = new Map(rows.map((row) => [row.channel, row]));
    return ALL_CHANNELS.map((channel) => this.toChannel(channel, byChannel.get(channel)));
  }

  /** Channels an administrator switched on. IN_APP is always on. */
  async enabledChannels(): Promise<Set<NotificationChannel>> {
    const rows = await this.prisma.notificationChannelSetting.findMany({
      where: { isEnabled: true },
    });
    return new Set([NotificationChannel.IN_APP, ...rows.map((row) => row.channel)]);
  }

  async updateChannel(
    channel: NotificationChannel,
    dto: UpdateChannelSettingDto,
    actor: AuthenticatedUser,
  ): Promise<ChannelSettingResponseDto> {
    if (channel === NotificationChannel.IN_APP && !dto.isEnabled) {
      throw new ConflictException('IN_APP is the notification inbox and cannot be disabled');
    }
    if (dto.isEnabled && !this.registry.canDeliver(channel)) {
      throw new ConflictException(
        `No provider is registered for ${channel}, so it cannot be enabled. Register a provider first.`,
      );
    }
    const before = await this.prisma.notificationChannelSetting.findUnique({ where: { channel } });
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.notificationChannelSetting.upsert({
        where: { channel },
        update: { isEnabled: dto.isEnabled, updatedById: actor.id },
        create: { channel, isEnabled: dto.isEnabled, updatedById: actor.id },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: NotificationAuditAction.ChannelUpdated,
          entityType: NotificationAuditEntity.ChannelSetting,
          entityId: channel,
          details: {
            from: before?.isEnabled ?? false,
            to: saved.isEnabled,
          } satisfies Prisma.InputJsonValue,
        },
        tx,
      );
      return saved;
    });
    return this.toChannel(channel, row);
  }

  // -------------------------------------------------------------------- mapping

  private toPolicy(
    category: NotificationCategory,
    row?: NotificationCategorySetting,
  ): CategoryPolicy {
    const locked = LOCKED_ESSENTIAL_CATEGORIES.includes(category);
    return {
      category,
      isEssential: locked || (row?.isEssential ?? false),
      isActive: locked || (row?.isActive ?? true),
      allowedChannels: row?.allowedChannels ?? ALL_CHANNELS,
    };
  }

  private toCategory(
    category: NotificationCategory,
    row?: NotificationCategorySetting,
  ): CategorySettingResponseDto {
    return {
      ...this.toPolicy(category, row),
      isLocked: LOCKED_ESSENTIAL_CATEGORIES.includes(category),
      description: row?.description ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  private toChannel(
    channel: NotificationChannel,
    row?: { isEnabled: boolean; updatedAt: Date },
  ): ChannelSettingResponseDto {
    const info = this.registry.describe(channel);
    const isEnabled = channel === NotificationChannel.IN_APP || (row?.isEnabled ?? false);
    return {
      channel,
      isEnabled,
      isAvailable: isEnabled && this.registry.canDeliver(channel),
      providerRequired: info.providerRequired,
      providerRegistered: info.providerRegistered,
      providerId: info.providerId,
      isTestProvider: info.isTestDouble,
      supportedAccountTypes: ACCOUNT_TYPES[channel] ?? [],
      updatedAt: row?.updatedAt ?? null,
    };
  }
}
