import { Module } from '@nestjs/common';
import { CourseGenerationController } from './course-generation.controller';
import { CourseGenerationService } from './course-generation.service';

/** AI course generation requests. The model integration plugs into CourseGenerationService. */
@Module({
  controllers: [CourseGenerationController],
  providers: [CourseGenerationService],
  exports: [CourseGenerationService],
})
export class CourseGenerationModule {}
