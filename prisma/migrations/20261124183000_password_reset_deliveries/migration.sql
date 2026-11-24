-- CreateEnum
CREATE TYPE "PasswordResetDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "password_reset_deliveries" (
    "id" UUID NOT NULL,
    "passwordResetTokenId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" VARCHAR(8) NOT NULL,
    "destination" VARCHAR(254) NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'rw',
    "tokenCiphertext" BYTEA,
    "tokenNonce" BYTEA,
    "tokenAuthTag" BYTEA,
    "encryptionKeyVersion" INTEGER,
    "status" "PasswordResetDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_deliveries_passwordResetTokenId_key" ON "password_reset_deliveries"("passwordResetTokenId");

-- CreateIndex
CREATE INDEX "password_reset_deliveries_userId_idx" ON "password_reset_deliveries"("userId");

-- CreateIndex
CREATE INDEX "password_reset_deliveries_expiresAt_idx" ON "password_reset_deliveries"("expiresAt");

-- CreateIndex
CREATE INDEX "password_reset_deliveries_status_idx" ON "password_reset_deliveries"("status");

-- AddForeignKey
ALTER TABLE "password_reset_deliveries" ADD CONSTRAINT "password_reset_deliveries_passwordResetTokenId_fkey" FOREIGN KEY ("passwordResetTokenId") REFERENCES "password_reset_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_deliveries" ADD CONSTRAINT "password_reset_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;