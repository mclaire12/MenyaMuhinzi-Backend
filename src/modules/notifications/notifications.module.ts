import { Module } from '@nestjs/common';
import { NotificationChannelsService } from './channels/notification-channels.service';
import {
  AdminNotificationSettingsController,
  AdminNotificationTemplatesController,
} from './controllers/admin-notifications.controller';
import {
  NotificationPreferencesController,
  NotificationsController,
} from './controllers/notifications.controller';
import { NotificationDeliveryWorker } from './delivery/notification-delivery.worker';
import { NotificationDispatcher } from './delivery/notification-dispatcher.service';
import { NotificationsService } from './inbox/notifications.service';
import { NotificationPreferencesService } from './preferences/notification-preferences.service';
import { NOTIFICATION_PROVIDERS } from './providers/notification-provider.interfaces';
import { NotificationProviderRegistry } from './providers/notification-provider.registry';
import { NotificationPublisher } from './publishing/notification-publisher.service';
import { NotificationSettingsService } from './settings/notification-settings.service';
import { NotificationTemplatesService } from './templates/notification-templates.service';

@Module({
  controllers: [
    NotificationsController,
    NotificationPreferencesController,
    AdminNotificationTemplatesController,
    AdminNotificationSettingsController,
  ],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    NotificationTemplatesService,
    NotificationSettingsService,
    NotificationChannelsService,
    NotificationProviderRegistry,
    NotificationPublisher,
    NotificationDispatcher,
    NotificationDeliveryWorker,
    // No SMS, email, push, USSD or IVR provider is integrated: external deliveries are recorded
    // as skipped or failed with NOTIFICATION_PROVIDER_NOT_CONFIGURED and nothing is sent.
    { provide: NOTIFICATION_PROVIDERS, useValue: [] },
  ],
  // Other modules call NotificationPublisher.notifyEvent / notify when business events happen.
  exports: [NotificationPublisher],
})
export class NotificationsModule {}
