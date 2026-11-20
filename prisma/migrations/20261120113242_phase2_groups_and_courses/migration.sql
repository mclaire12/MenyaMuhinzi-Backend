-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TargetAudience" AS ENUM ('ALL_FARMERS', 'SMARTPHONE_FARMERS', 'BASIC_PHONE_FARMERS');

-- CreateEnum
CREATE TYPE "CourseCategory" AS ENUM ('CROP_PRODUCTION', 'PEST_AND_DISEASE_MANAGEMENT', 'SOIL_AND_FERTILITY', 'WATER_MANAGEMENT', 'POST_HARVEST', 'MARKETING', 'CLIMATE_SMART_AGRICULTURE', 'GENERAL');

-- CreateEnum
CREATE TYPE "DifficultyLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('TEXT', 'AUDIO', 'VIDEO', 'IMAGE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "PublicationScope" AS ENUM ('PLATFORM', 'TARGETED');

-- CreateTable
CREATE TABLE "crops" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "nameEn" VARCHAR(100) NOT NULL,
    "nameRw" VARCHAR(100) NOT NULL,
    "description" VARCHAR(2000),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_targeting_groups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "cropId" UUID NOT NULL,
    "targetAudience" "TargetAudience" NOT NULL,
    "province" "Province" NOT NULL,
    "district" VARCHAR(50) NOT NULL,
    "sector" VARCHAR(80),
    "estimatedFarmerCount" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_targeting_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facilitator_groups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "facilitatorId" UUID NOT NULL,
    "cropId" UUID NOT NULL,
    "province" "Province" NOT NULL,
    "district" VARCHAR(50) NOT NULL,
    "sector" VARCHAR(80) NOT NULL,
    "cell" VARCHAR(80),
    "village" VARCHAR(80),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facilitator_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facilitator_group_members" (
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "addedById" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facilitator_group_members_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "shortDescription" VARCHAR(500) NOT NULL,
    "detailedDescription" TEXT NOT NULL,
    "cropId" UUID NOT NULL,
    "category" "CourseCategory" NOT NULL,
    "targetAudience" "TargetAudience" NOT NULL,
    "difficulty" "DifficultyLevel" NOT NULL,
    "learningObjectives" TEXT[],
    "estimatedDurationMinutes" INTEGER NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'rw',
    "coverImageRef" VARCHAR(500),
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "learningObjectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "displayOrder" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "moduleId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "lessonType" "LessonType" NOT NULL,
    "contentRef" VARCHAR(500),
    "language" "Language" NOT NULL DEFAULT 'rw',
    "estimatedDurationMinutes" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_publications" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "scope" "PublicationScope" NOT NULL,
    "publishedById" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unpublishedAt" TIMESTAMP(3),
    "unpublishedById" UUID,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "course_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_publication_targets" (
    "publicationId" UUID NOT NULL,
    "groupId" UUID NOT NULL,

    CONSTRAINT "course_publication_targets_pkey" PRIMARY KEY ("publicationId","groupId")
);

-- CreateTable
CREATE TABLE "facilitator_group_courses" (
    "groupId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facilitator_group_courses_pkey" PRIMARY KEY ("groupId","courseId")
);

-- CreateIndex
CREATE UNIQUE INDEX "crops_code_key" ON "crops"("code");

-- CreateIndex
CREATE UNIQUE INDEX "crops_nameEn_key" ON "crops"("nameEn");

-- CreateIndex
CREATE UNIQUE INDEX "crops_nameRw_key" ON "crops"("nameRw");

-- CreateIndex
CREATE INDEX "admin_targeting_groups_status_createdAt_idx" ON "admin_targeting_groups"("status", "createdAt");

-- CreateIndex
CREATE INDEX "admin_targeting_groups_cropId_idx" ON "admin_targeting_groups"("cropId");

-- CreateIndex
CREATE INDEX "admin_targeting_groups_province_district_idx" ON "admin_targeting_groups"("province", "district");

-- CreateIndex
CREATE INDEX "facilitator_groups_facilitatorId_status_idx" ON "facilitator_groups"("facilitatorId", "status");

-- CreateIndex
CREATE INDEX "facilitator_groups_cropId_idx" ON "facilitator_groups"("cropId");

-- CreateIndex
CREATE INDEX "facilitator_groups_province_district_idx" ON "facilitator_groups"("province", "district");

-- CreateIndex
CREATE INDEX "facilitator_group_members_userId_idx" ON "facilitator_group_members"("userId");

-- CreateIndex
CREATE INDEX "courses_status_createdAt_idx" ON "courses"("status", "createdAt");

-- CreateIndex
CREATE INDEX "courses_cropId_idx" ON "courses"("cropId");

-- CreateIndex
CREATE INDEX "courses_language_idx" ON "courses"("language");

-- CreateIndex
CREATE INDEX "courses_createdById_idx" ON "courses"("createdById");

-- CreateIndex
CREATE INDEX "course_modules_courseId_displayOrder_idx" ON "course_modules"("courseId", "displayOrder");

-- CreateIndex
CREATE INDEX "lessons_moduleId_displayOrder_idx" ON "lessons"("moduleId", "displayOrder");

-- CreateIndex
CREATE INDEX "course_publications_courseId_isCurrent_idx" ON "course_publications"("courseId", "isCurrent");

-- CreateIndex
CREATE INDEX "course_publications_publishedById_idx" ON "course_publications"("publishedById");

-- CreateIndex
CREATE INDEX "course_publication_targets_groupId_idx" ON "course_publication_targets"("groupId");

-- CreateIndex
CREATE INDEX "facilitator_group_courses_courseId_idx" ON "facilitator_group_courses"("courseId");

-- AddForeignKey
ALTER TABLE "admin_targeting_groups" ADD CONSTRAINT "admin_targeting_groups_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_targeting_groups" ADD CONSTRAINT "admin_targeting_groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilitator_groups" ADD CONSTRAINT "facilitator_groups_facilitatorId_fkey" FOREIGN KEY ("facilitatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilitator_groups" ADD CONSTRAINT "facilitator_groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilitator_groups" ADD CONSTRAINT "facilitator_groups_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilitator_group_members" ADD CONSTRAINT "facilitator_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "facilitator_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilitator_group_members" ADD CONSTRAINT "facilitator_group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilitator_group_members" ADD CONSTRAINT "facilitator_group_members_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_publications" ADD CONSTRAINT "course_publications_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_publications" ADD CONSTRAINT "course_publications_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_publications" ADD CONSTRAINT "course_publications_unpublishedById_fkey" FOREIGN KEY ("unpublishedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_publication_targets" ADD CONSTRAINT "course_publication_targets_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "course_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_publication_targets" ADD CONSTRAINT "course_publication_targets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "admin_targeting_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilitator_group_courses" ADD CONSTRAINT "facilitator_group_courses_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "facilitator_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilitator_group_courses" ADD CONSTRAINT "facilitator_group_courses_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilitator_group_courses" ADD CONSTRAINT "facilitator_group_courses_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One open publication per course. Closed rows stay as history.
CREATE UNIQUE INDEX "course_publications_one_current_per_course" ON "course_publications"("courseId") WHERE "isCurrent" = true;
