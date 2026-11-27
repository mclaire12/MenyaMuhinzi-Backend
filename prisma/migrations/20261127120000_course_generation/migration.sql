-- CreateEnum
CREATE TYPE "CourseGenerationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CourseGenerationScope" AS ENUM ('PLATFORM', 'GROUP');

-- CreateEnum
CREATE TYPE "LearningFormat" AS ENUM ('TEXT', 'AUDIO', 'VIDEO');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "ownerGroupId" UUID;

-- AlterTable
ALTER TABLE "knowledge_sources" ADD COLUMN     "includeInTraining" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "course_generation_requests" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "scope" "CourseGenerationScope" NOT NULL,
    "facilitatorGroupId" UUID,
    "brief" TEXT NOT NULL,
    "structure" JSONB NOT NULL,
    "contentFormats" "LearningFormat"[],
    "status" "CourseGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" VARCHAR(1000),
    "modelId" UUID,
    "requestedById" UUID NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_generation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_generation_sources" (
    "requestId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,

    CONSTRAINT "course_generation_sources_pkey" PRIMARY KEY ("requestId","sourceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_generation_requests_courseId_key" ON "course_generation_requests"("courseId");

-- CreateIndex
CREATE INDEX "course_generation_requests_status_createdAt_idx" ON "course_generation_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "course_generation_requests_requestedById_idx" ON "course_generation_requests"("requestedById");

-- CreateIndex
CREATE INDEX "course_generation_requests_facilitatorGroupId_idx" ON "course_generation_requests"("facilitatorGroupId");

-- CreateIndex
CREATE INDEX "course_generation_sources_sourceId_idx" ON "course_generation_sources"("sourceId");

-- CreateIndex
CREATE INDEX "courses_ownerGroupId_idx" ON "courses"("ownerGroupId");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_ownerGroupId_fkey" FOREIGN KEY ("ownerGroupId") REFERENCES "facilitator_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_generation_requests" ADD CONSTRAINT "course_generation_requests_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_generation_requests" ADD CONSTRAINT "course_generation_requests_facilitatorGroupId_fkey" FOREIGN KEY ("facilitatorGroupId") REFERENCES "facilitator_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_generation_requests" ADD CONSTRAINT "course_generation_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_generation_sources" ADD CONSTRAINT "course_generation_sources_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "course_generation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_generation_sources" ADD CONSTRAINT "course_generation_sources_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

