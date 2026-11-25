-- Email verification now needs the link (token) AND the 6-digit code sent in the same email.
-- Only a hash of the code is stored. Outstanding links issued before this migration have no
-- code, so they are retired; users request a new email from the sign-in page.
ALTER TABLE "email_verification_tokens"
  ADD COLUMN "otpHash" VARCHAR(128),
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;

UPDATE "email_verification_tokens"
SET "usedAt" = CURRENT_TIMESTAMP
WHERE "usedAt" IS NULL;
