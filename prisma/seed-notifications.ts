import {
  NotificationCategory,
  NotificationChannel,
  NotificationTemplateStatus,
  type PrismaClient,
} from '../src/generated/prisma/client';
import { SYSTEM_TEMPLATES } from '../src/modules/notifications/events/system-templates';
import {
  ALL_CATEGORIES,
  ALL_CHANNELS,
  LOCKED_ESSENTIAL_CATEGORIES,
} from '../src/modules/notifications/notifications.constants';

const CATEGORY_DESCRIPTIONS: Record<NotificationCategory, string> = {
  ACCOUNT: 'Account status changes',
  ACCOUNT_APPROVAL: 'Account request decisions',
  COURSE: 'Course enrollment and publication',
  LEARNING: 'Learning progress and reminders',
  ASSESSMENT: 'Assessment results and reviews',
  GROUP: 'Farmer group membership',
  FACILITATOR: 'Facilitator messages',
  SYSTEM: 'Platform announcements',
  SECURITY: 'Security alerts such as password changes',
  GENERAL: 'Other messages',
};

/**
 * Category policy, channel switches and the templates for built-in events. Rows that already exist
 * are never changed, so an administrator's edits survive a re-seed. Only IN_APP is enabled: every
 * other channel stays off until a provider is registered and an administrator enables it.
 */
export async function seedNotifications(prisma: PrismaClient): Promise<void> {
  for (const category of ALL_CATEGORIES) {
    const locked = LOCKED_ESSENTIAL_CATEGORIES.includes(category);
    await prisma.notificationCategorySetting.upsert({
      where: { category },
      update: {},
      create: {
        category,
        isEssential: locked,
        isActive: true,
        allowedChannels: ALL_CHANNELS,
        description: CATEGORY_DESCRIPTIONS[category],
      },
    });
  }

  for (const channel of ALL_CHANNELS) {
    await prisma.notificationChannelSetting.upsert({
      where: { channel },
      update: {},
      create: { channel, isEnabled: channel === NotificationChannel.IN_APP },
    });
  }

  for (const seed of SYSTEM_TEMPLATES) {
    const existing = await prisma.notificationTemplate.findUnique({
      where: {
        code_channel_language: { code: seed.code, channel: seed.channel, language: seed.language },
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.$transaction(async (tx) => {
      const template = await tx.notificationTemplate.create({
        data: {
          code: seed.code,
          channel: seed.channel,
          language: seed.language,
          name: seed.name,
          description: seed.description,
          category: seed.category,
          status: seed.activate
            ? NotificationTemplateStatus.ACTIVE
            : NotificationTemplateStatus.DRAFT,
          isSystem: true,
          latestVersionNumber: 1,
        },
      });
      const version = await tx.notificationTemplateVersion.create({
        data: {
          templateId: template.id,
          versionNumber: 1,
          subject: seed.subject,
          body: seed.body,
          variables: JSON.parse(JSON.stringify(seed.variables)),
          changeNote: 'Initial seed',
        },
      });
      await tx.notificationTemplate.update({
        where: { id: template.id },
        data: { currentVersionId: version.id },
      });
    });
  }
}
