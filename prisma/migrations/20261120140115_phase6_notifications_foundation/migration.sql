-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ACCOUNT', 'ACCOUNT_APPROVAL', 'COURSE', 'LEARNING', 'ASSESSMENT', 'GROUP', 'FACILITATOR', 'SYSTEM', 'SECURITY', 'GENERAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'EMAIL', 'PUSH', 'USSD', 'IVR');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "templateCode" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "isEssential" BOOLEAN NOT NULL DEFAULT false,
    "entityType" VARCHAR(60),
    "entityId" VARCHAR(100),
    "dedupeKey" VARCHAR(200),
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL,
    "language" "Language" NOT NULL,
    "templateVersionId" UUID,
    "subject" VARCHAR(200),
    "body" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerId" VARCHAR(100),
    "providerMessageId" VARCHAR(200),
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "reasonCode" VARCHAR(60),
    "scheduledFor" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "language" "Language" NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "category" "NotificationCategory" NOT NULL,
    "status" "NotificationTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "currentVersionId" UUID,
    "latestVersionNumber" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_template_versions" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "changeNote" VARCHAR(1000),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_category_settings" (
    "category" "NotificationCategory" NOT NULL,
    "isEssential" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowedChannels" "NotificationChannel"[],
    "description" VARCHAR(500),
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_category_settings_pkey" PRIMARY KEY ("category")
);

-- CreateTable
CREATE TABLE "notification_channel_settings" (
    "channel" "NotificationChannel" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channel_settings_pkey" PRIMARY KEY ("channel")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "userId" UUID NOT NULL,
    "preferredLanguage" "Language",
    "timeZone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Kigali',
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" VARCHAR(5),
    "quietHoursEnd" VARCHAR(5),
    "nonEssentialEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "notification_channel_preferences" (
    "userId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channel_preferences_pkey" PRIMARY KEY ("userId","channel")
);

-- CreateTable
CREATE TABLE "notification_category_preferences" (
    "userId" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_category_preferences_pkey" PRIMARY KEY ("userId","category")
);

-- CreateIndex
CREATE INDEX "notifications_userId_archivedAt_readAt_createdAt_idx" ON "notifications"("userId", "archivedAt", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_category_idx" ON "notifications"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_channel_idx" ON "notification_deliveries"("status", "channel");

-- CreateIndex
CREATE INDEX "notification_deliveries_createdAt_idx" ON "notification_deliveries"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_currentVersionId_key" ON "notification_templates"("currentVersionId");

-- CreateIndex
CREATE INDEX "notification_templates_category_status_idx" ON "notification_templates"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_code_channel_language_key" ON "notification_templates"("code", "channel", "language");

-- CreateIndex
CREATE UNIQUE INDEX "notification_template_versions_templateId_versionNumber_key" ON "notification_template_versions"("templateId", "versionNumber");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "notification_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "notification_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_template_versions" ADD CONSTRAINT "notification_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "notification_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_template_versions" ADD CONSTRAINT "notification_template_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_category_settings" ADD CONSTRAINT "notification_category_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channel_settings" ADD CONSTRAINT "notification_channel_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channel_preferences" ADD CONSTRAINT "notification_channel_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_category_preferences" ADD CONSTRAINT "notification_category_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Manual constraints (not expressible in the Prisma schema)

-- A message counts as sent or delivered only when a provider handled it; IN_APP is stored by the platform itself.
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_sent_requires_provider"
  CHECK ("channel" = 'IN_APP' OR "status" NOT IN ('SENT', 'DELIVERED') OR "providerId" IS NOT NULL);
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_delivered_has_timestamp"
  CHECK ("status" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL);
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_attempts_non_negative"
  CHECK ("attempts" >= 0);

ALTER TABLE "notification_template_versions" ADD CONSTRAINT "notification_template_versions_number_positive"
  CHECK ("versionNumber" > 0);

-- Essential categories (account, approval, security) cannot be made optional or switched off.
ALTER TABLE "notification_category_settings" ADD CONSTRAINT "notification_category_settings_locked_essential"
  CHECK ("category" NOT IN ('ACCOUNT', 'ACCOUNT_APPROVAL', 'SECURITY') OR ("isEssential" AND "isActive"));
-- The in-app inbox is the record of every notification.
ALTER TABLE "notification_category_settings" ADD CONSTRAINT "notification_category_settings_in_app_allowed"
  CHECK ('IN_APP'::"NotificationChannel" = ANY ("allowedChannels"));

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_quiet_hours_format"
  CHECK (
    ("quietHoursStart" IS NULL OR "quietHoursStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND ("quietHoursEnd" IS NULL OR "quietHoursEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  );
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_quiet_hours_complete"
  CHECK (NOT "quietHoursEnabled" OR ("quietHoursStart" IS NOT NULL AND "quietHoursEnd" IS NOT NULL AND "quietHoursStart" <> "quietHoursEnd"));
