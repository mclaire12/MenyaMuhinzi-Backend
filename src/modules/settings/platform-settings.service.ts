import { Injectable } from '@nestjs/common';
import { Language, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  PlatformSettingsResponseDto,
  UpdatePlatformSettingsDto,
} from './platform-settings.dto';

export const PLATFORM_SETTINGS_KEY = 'platform';

type StoredSettings = Omit<PlatformSettingsResponseDto, 'updatedAt' | 'updatedBy'>;

export const DEFAULT_PLATFORM_SETTINGS: StoredSettings = {
  platform: { name: 'MenyaMuhinzi', tagline: 'Iga. Hinga. Usarure neza.', supportEmail: '', supportPhone: '' },
  defaultLanguage: Language.rw,
  defaultPublicationScope: 'PLATFORM',
  adminNotifications: { accountRequests: true, aiFailures: true, coursePublished: false, weeklySummary: false },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Stored values over defaults; unknown keys in the stored JSON are ignored. */
function merge(stored: unknown): StoredSettings {
  const value = isRecord(stored) ? stored : {};
  const platform = isRecord(value['platform']) ? value['platform'] : {};
  const notifications = isRecord(value['adminNotifications']) ? value['adminNotifications'] : {};
  const text = (input: unknown, fallback: string) => (typeof input === 'string' ? input : fallback);
  const flag = (input: unknown, fallback: boolean) => (typeof input === 'boolean' ? input : fallback);
  const defaults = DEFAULT_PLATFORM_SETTINGS;
  return {
    platform: {
      name: text(platform['name'], defaults.platform.name),
      tagline: text(platform['tagline'], defaults.platform.tagline),
      supportEmail: text(platform['supportEmail'], defaults.platform.supportEmail),
      supportPhone: text(platform['supportPhone'], defaults.platform.supportPhone),
    },
    defaultLanguage: value['defaultLanguage'] === Language.en ? Language.en : defaults.defaultLanguage,
    defaultPublicationScope: value['defaultPublicationScope'] === 'TARGETED' ? 'TARGETED' : 'PLATFORM',
    adminNotifications: {
      accountRequests: flag(notifications['accountRequests'], defaults.adminNotifications.accountRequests),
      aiFailures: flag(notifications['aiFailures'], defaults.adminNotifications.aiFailures),
      coursePublished: flag(notifications['coursePublished'], defaults.adminNotifications.coursePublished),
      weeklySummary: flag(notifications['weeklySummary'], defaults.adminNotifications.weeklySummary),
    },
  };
}

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<PlatformSettingsResponseDto> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: PLATFORM_SETTINGS_KEY },
      select: { value: true, updatedAt: true, updatedBy: { select: { fullName: true } } },
    });
    return {
      ...merge(row?.value),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy?.fullName ?? null,
    };
  }

  async update(dto: UpdatePlatformSettingsDto, actor: AuthenticatedUser): Promise<PlatformSettingsResponseDto> {
    const current = merge(
      (await this.prisma.platformSetting.findUnique({ where: { key: PLATFORM_SETTINGS_KEY } }))?.value,
    );
    const next: StoredSettings = {
      platform: dto.platform ? { ...dto.platform } : current.platform,
      defaultLanguage: dto.defaultLanguage ?? current.defaultLanguage,
      defaultPublicationScope: dto.defaultPublicationScope ?? current.defaultPublicationScope,
      adminNotifications: dto.adminNotifications ? { ...dto.adminNotifications } : current.adminNotifications,
    };
    const value = next as unknown as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: PLATFORM_SETTINGS_KEY },
        create: { key: PLATFORM_SETTINGS_KEY, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'platform-settings.update',
          entityType: 'PlatformSetting',
          entityId: PLATFORM_SETTINGS_KEY,
          details: { changed: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.get();
  }
}
