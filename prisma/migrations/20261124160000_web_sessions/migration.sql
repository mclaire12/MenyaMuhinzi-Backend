-- Additive browser-session store. Existing users and refresh tokens are left in place.

CREATE TABLE "web_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionHash" VARCHAR(64) NOT NULL,
    "familyId" UUID NOT NULL,
    "refreshTokenId" UUID NOT NULL,
    "refreshCiphertext" BYTEA NOT NULL,
    "refreshNonce" BYTEA NOT NULL,
    "refreshAuthTag" BYTEA NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "TokenRevocationReason",

    CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_sessions_sessionHash_key" ON "web_sessions"("sessionHash");

CREATE UNIQUE INDEX "web_sessions_refreshTokenId_key" ON "web_sessions"("refreshTokenId");

CREATE INDEX "web_sessions_userId_idx" ON "web_sessions"("userId");

CREATE INDEX "web_sessions_familyId_idx" ON "web_sessions"("familyId");

CREATE INDEX "web_sessions_idleExpiresAt_idx" ON "web_sessions"("idleExpiresAt");

CREATE INDEX "web_sessions_absoluteExpiresAt_idx" ON "web_sessions"("absoluteExpiresAt");

ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_refreshTokenId_fkey" FOREIGN KEY ("refreshTokenId") REFERENCES "refresh_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
