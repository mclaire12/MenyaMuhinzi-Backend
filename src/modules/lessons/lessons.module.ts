import { Module } from '@nestjs/common';

/**
 * Lesson CRUD lives in CoursesModule, because a lesson only exists inside a
 * course module. This module remains for the learning experience in a later phase.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class LessonsModule {}
