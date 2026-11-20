import { NotificationCategory, NotificationChannel } from '../../../generated/prisma/client';

/**
 * Business events that create notifications. `code` is the template code; the seed provides
 * in-app and SMS templates in Kinyarwanda and English for each. `channels` are the channels
 * requested besides the in-app inbox, which every notification has.
 */
export interface NotificationEventDefinition {
  code: string;
  category: NotificationCategory;
  channels: NotificationChannel[];
}

const essential = [NotificationChannel.SMS, NotificationChannel.EMAIL, NotificationChannel.PUSH];
const routine = [NotificationChannel.SMS, NotificationChannel.PUSH];

export const NotificationEvent = {
  AccountApproved: {
    code: 'ACCOUNT_APPROVED',
    category: NotificationCategory.ACCOUNT_APPROVAL,
    channels: essential,
  },
  AccountRejected: {
    code: 'ACCOUNT_REJECTED',
    category: NotificationCategory.ACCOUNT_APPROVAL,
    channels: essential,
  },
  AccountSuspended: {
    code: 'ACCOUNT_SUSPENDED',
    category: NotificationCategory.ACCOUNT,
    channels: essential,
  },
  AccountDeactivated: {
    code: 'ACCOUNT_DEACTIVATED',
    category: NotificationCategory.ACCOUNT,
    channels: essential,
  },
  AccountReactivated: {
    code: 'ACCOUNT_REACTIVATED',
    category: NotificationCategory.ACCOUNT,
    channels: essential,
  },
  PasswordChanged: {
    code: 'PASSWORD_CHANGED',
    category: NotificationCategory.SECURITY,
    channels: essential,
  },
  CourseEnrolled: {
    code: 'COURSE_ENROLLED',
    category: NotificationCategory.COURSE,
    channels: routine,
  },
  GroupMemberAdded: {
    code: 'GROUP_MEMBER_ADDED',
    category: NotificationCategory.GROUP,
    channels: routine,
  },
  AssessmentReviewed: {
    code: 'ASSESSMENT_REVIEWED',
    category: NotificationCategory.ASSESSMENT,
    channels: routine,
  },
} as const satisfies Record<string, NotificationEventDefinition>;
