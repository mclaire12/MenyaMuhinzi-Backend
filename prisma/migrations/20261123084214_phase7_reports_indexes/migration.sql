-- CreateIndex
CREATE INDEX "assessment_attempts_startedAt_idx" ON "assessment_attempts"("startedAt");

-- CreateIndex
CREATE INDEX "assessment_attempts_status_startedAt_idx" ON "assessment_attempts"("status", "startedAt");

-- CreateIndex
CREATE INDEX "course_enrollments_enrolledAt_idx" ON "course_enrollments"("enrolledAt");

-- CreateIndex
CREATE INDEX "learning_sessions_startedAt_idx" ON "learning_sessions"("startedAt");

-- CreateIndex
CREATE INDEX "learning_sessions_channel_startedAt_idx" ON "learning_sessions"("channel", "startedAt");

-- CreateIndex
CREATE INDEX "lesson_progress_lastAccessedAt_idx" ON "lesson_progress"("lastAccessedAt");
