-- CreateTable
CREATE TABLE "user_oauth_identities" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(254),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_oauth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_oauth_identities_provider_subject_key" ON "user_oauth_identities"("provider", "subject");

-- CreateIndex
CREATE INDEX "user_oauth_identities_userId_idx" ON "user_oauth_identities"("userId");

-- AddForeignKey
ALTER TABLE "user_oauth_identities" ADD CONSTRAINT "user_oauth_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;