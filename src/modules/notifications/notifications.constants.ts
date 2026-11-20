import { NotificationCategory, NotificationChannel } from '../../generated/prisma/client';
import { RoleCode } from '../roles/rbac.constants';

export const NOTIFICATION_JOB_NAME = 'deliver';

/** Provider id recorded for deliveries the platform makes itself (the in-app inbox). */
export const IN_APP_PROVIDER_ID = 'in-app';

export const TEMPLATE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,59}$/;

export const NotificationErrorCode = {
  ProviderNotConfigured: 'NOTIFICATION_PROVIDER_NOT_CONFIGURED',
  ChannelDisabled: 'NOTIFICATION_CHANNEL_DISABLED',
  ChannelNotSupported: 'NOTIFICATION_CHANNEL_NOT_SUPPORTED',
  ChannelNotAllowedForCategory: 'NOTIFICATION_CHANNEL_NOT_ALLOWED_FOR_CATEGORY',
  ChannelDisabledByUser: 'NOTIFICATION_CHANNEL_DISABLED_BY_USER',
  NoAddress: 'NOTIFICATION_NO_ADDRESS',
  TemplateMissing: 'NOTIFICATION_TEMPLATE_MISSING',
  TemplateVariablesInvalid: 'NOTIFICATION_TEMPLATE_VARIABLES_INVALID',
  ProviderError: 'NOTIFICATION_PROVIDER_ERROR',
  QueueUnavailable: 'NOTIFICATION_QUEUE_UNAVAILABLE',
  UserUnavailable: 'NOTIFICATION_USER_UNAVAILABLE',
} as const;

export type NotificationErrorCode =
  (typeof NotificationErrorCode)[keyof typeof NotificationErrorCode];

export const NotificationErrorMessage: Record<NotificationErrorCode, string> = {
  NOTIFICATION_PROVIDER_NOT_CONFIGURED:
    'No provider is registered for this channel; nothing was sent.',
  NOTIFICATION_CHANNEL_DISABLED: 'This channel is not enabled by an administrator.',
  NOTIFICATION_CHANNEL_NOT_SUPPORTED: 'This channel is not supported for this account type.',
  NOTIFICATION_CHANNEL_NOT_ALLOWED_FOR_CATEGORY: 'This category does not allow this channel.',
  NOTIFICATION_CHANNEL_DISABLED_BY_USER: 'The user turned this channel off.',
  NOTIFICATION_NO_ADDRESS: 'The user has no address on file for this channel.',
  NOTIFICATION_TEMPLATE_MISSING: 'No active template exists for this channel.',
  NOTIFICATION_TEMPLATE_VARIABLES_INVALID: 'The template variables are missing or invalid.',
  NOTIFICATION_PROVIDER_ERROR: 'The provider could not send the message.',
  NOTIFICATION_QUEUE_UNAVAILABLE: 'The delivery could not be queued.',
  NOTIFICATION_USER_UNAVAILABLE: 'The recipient account is no longer available.',
};

export const NotificationAuditEntity = {
  Template: 'notification-template',
  CategorySetting: 'notification-category',
  ChannelSetting: 'notification-channel',
  Preferences: 'notification-preferences',
} as const;

export const NotificationAuditAction = {
  TemplateCreated: 'notification-template.created',
  TemplateUpdated: 'notification-template.updated',
  TemplateVersionAdded: 'notification-template.version-added',
  TemplateCurrentVersionSet: 'notification-template.current-version-set',
  TemplateActivated: 'notification-template.activated',
  TemplateDeactivated: 'notification-template.deactivated',
  TemplateArchived: 'notification-template.archived',
  CategoryUpdated: 'notification-category.updated',
  ChannelUpdated: 'notification-channel.updated',
  PreferencesUpdated: 'notification-preferences.updated',
} as const;

/** Categories every user must keep receiving: account state, approvals and security. */
export const LOCKED_ESSENTIAL_CATEGORIES: readonly NotificationCategory[] = [
  NotificationCategory.ACCOUNT,
  NotificationCategory.ACCOUNT_APPROVAL,
  NotificationCategory.SECURITY,
];

export const ALL_CATEGORIES: NotificationCategory[] = Object.values(NotificationCategory);
export const ALL_CHANNELS: NotificationChannel[] = Object.values(NotificationChannel);

/** Channels that need a registered provider before they can be enabled. */
export const EXTERNAL_CHANNELS: NotificationChannel[] = ALL_CHANNELS.filter(
  (channel) => channel !== NotificationChannel.IN_APP,
);

const APP_USER_CHANNELS: NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
  NotificationChannel.PUSH,
];
const BASIC_PHONE_CHANNELS: NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.SMS,
  NotificationChannel.USSD,
  NotificationChannel.IVR,
];

/**
 * Channels an account can use. Basic-phone farmers have no app and are not expected to have
 * email; USSD and IVR exist for them. Everyone else has the app, SMS and email.
 */
export function supportedChannelsForRoles(roles: readonly string[]): NotificationChannel[] {
  const supported = new Set<NotificationChannel>([NotificationChannel.IN_APP]);
  for (const role of roles) {
    const channels = role === RoleCode.BasicPhoneFarmer ? BASIC_PHONE_CHANNELS : APP_USER_CHANNELS;
    for (const channel of channels) supported.add(channel);
  }
  return ALL_CHANNELS.filter((channel) => supported.has(channel));
}

export type SubjectRule = 'required' | 'forbidden';

export interface ChannelContentRule {
  subject: SubjectRule;
  maxSubject: number;
  maxBody: number;
}

/** Content limits per channel. An SMS segment is 160 characters; 480 allows three. */
export const CHANNEL_CONTENT_RULES: Record<NotificationChannel, ChannelContentRule> = {
  IN_APP: { subject: 'required', maxSubject: 200, maxBody: 2000 },
  SMS: { subject: 'forbidden', maxSubject: 0, maxBody: 480 },
  EMAIL: { subject: 'required', maxSubject: 200, maxBody: 20_000 },
  PUSH: { subject: 'required', maxSubject: 100, maxBody: 240 },
  USSD: { subject: 'forbidden', maxSubject: 0, maxBody: 160 },
  IVR: { subject: 'forbidden', maxSubject: 0, maxBody: 1000 },
};

export const DEFAULT_TIME_ZONE = 'Africa/Kigali';
