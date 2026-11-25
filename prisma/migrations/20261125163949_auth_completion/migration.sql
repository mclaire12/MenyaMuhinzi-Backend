ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

UPDATE "users"
SET "emailVerifiedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
WHERE "status" = 'ACTIVE' AND "email" IS NOT NULL;

CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key"
ON "email_verification_tokens"("tokenHash");
CREATE INDEX "email_verification_tokens_userId_idx"
ON "email_verification_tokens"("userId");

ALTER TABLE "email_verification_tokens"
ADD CONSTRAINT "email_verification_tokens_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
