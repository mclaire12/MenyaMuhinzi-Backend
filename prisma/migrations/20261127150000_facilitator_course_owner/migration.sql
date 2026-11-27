-- Facilitator courses are owned by the facilitator who generated them and are published to
-- one or more of their groups (facilitator_group_courses), instead of being tied to one group.

-- 1. New owner column, filled from the group that previously owned the course.
ALTER TABLE "courses" ADD COLUMN "facilitatorOwnerId" UUID;

UPDATE "courses" c
SET "facilitatorOwnerId" = g."facilitatorId"
FROM "facilitator_groups" g
WHERE c."ownerGroupId" = g."id";

CREATE INDEX "courses_facilitatorOwnerId_idx" ON "courses"("facilitatorOwnerId");

ALTER TABLE "courses" ADD CONSTRAINT "courses_facilitatorOwnerId_fkey" FOREIGN KEY ("facilitatorOwnerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Groups are now chosen when publishing, not when generating.
ALTER TABLE "courses" DROP CONSTRAINT "courses_ownerGroupId_fkey";
DROP INDEX "courses_ownerGroupId_idx";
ALTER TABLE "courses" DROP COLUMN "ownerGroupId";

ALTER TABLE "course_generation_requests" DROP CONSTRAINT "course_generation_requests_facilitatorGroupId_fkey";
DROP INDEX "course_generation_requests_facilitatorGroupId_idx";
ALTER TABLE "course_generation_requests" DROP COLUMN "facilitatorGroupId";
