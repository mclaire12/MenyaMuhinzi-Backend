-- CreateEnum
CREATE TYPE "TelephonySessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TelephonyEndReason" AS ENUM ('USER_EXIT', 'TIMEOUT', 'PROVIDER_END', 'ERROR', 'ADMIN_TERMINATED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "ussd_sessions" (
    "id" UUID NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "providerSessionId" VARCHAR(128) NOT NULL,
    "phoneNumber" VARCHAR(20) NOT NULL,
    "userId" UUID,
    "language" "Language",
    "status" "TelephonySessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "menuCode" VARCHAR(64) NOT NULL DEFAULT 'MAIN',
    "state" JSONB NOT NULL DEFAULT '{}',
    "learningSessionId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" "TelephonyEndReason",
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "lastInputHash" VARCHAR(64),
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ussd_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ivr_sessions" (
    "id" UUID NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "providerSessionId" VARCHAR(128) NOT NULL,
    "callSid" VARCHAR(128),
    "phoneNumber" VARCHAR(20) NOT NULL,
    "userId" UUID,
    "language" "Language",
    "status" "TelephonySessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "menuCode" VARCHAR(64) NOT NULL DEFAULT 'MAIN',
    "state" JSONB NOT NULL DEFAULT '{}',
    "learningSessionId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" "TelephonyEndReason",
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "lastInputHash" VARCHAR(64),
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ivr_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_channel_settings" (
    "channel" VARCHAR(8) NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "serviceCode" VARCHAR(32),
    "accessNumber" VARCHAR(32),
    "sessionTtlSeconds" INTEGER NOT NULL,
    "maxScreenChars" INTEGER NOT NULL DEFAULT 160,
    "menuVersion" VARCHAR(16) NOT NULL DEFAULT '1',
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telephony_channel_settings_pkey" PRIMARY KEY ("channel")
);

-- CreateIndex
CREATE UNIQUE INDEX "ussd_sessions_providerId_providerSessionId_key" ON "ussd_sessions"("providerId", "providerSessionId");

-- CreateIndex
CREATE INDEX "ussd_sessions_userId_startedAt_idx" ON "ussd_sessions"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "ussd_sessions_status_lastActivityAt_idx" ON "ussd_sessions"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ussd_sessions_phoneNumber_idx" ON "ussd_sessions"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ivr_sessions_providerId_providerSessionId_key" ON "ivr_sessions"("providerId", "providerSessionId");

-- CreateIndex
CREATE INDEX "ivr_sessions_userId_startedAt_idx" ON "ivr_sessions"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "ivr_sessions_status_lastActivityAt_idx" ON "ivr_sessions"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ivr_sessions_phoneNumber_idx" ON "ivr_sessions"("phoneNumber");

-- AddForeignKey
ALTER TABLE "ussd_sessions" ADD CONSTRAINT "ussd_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ussd_sessions" ADD CONSTRAINT "ussd_sessions_learningSessionId_fkey" FOREIGN KEY ("learningSessionId") REFERENCES "learning_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ivr_sessions" ADD CONSTRAINT "ivr_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ivr_sessions" ADD CONSTRAINT "ivr_sessions_learningSessionId_fkey" FOREIGN KEY ("learningSessionId") REFERENCES "learning_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_channel_settings" ADD CONSTRAINT "telephony_channel_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual CHECK constraints
ALTER TABLE "telephony_channel_settings" ADD CONSTRAINT "telephony_channel_settings_channel_check" CHECK ("channel" IN ('USSD', 'IVR'));

ALTER TABLE "telephony_channel_settings" ADD CONSTRAINT "telephony_channel_settings_ttl_check" CHECK ("sessionTtlSeconds" > 0);

ALTER TABLE "telephony_channel_settings" ADD CONSTRAINT "telephony_channel_settings_max_screen_check" CHECK ("maxScreenChars" >= 40 AND "maxScreenChars" <= 500);