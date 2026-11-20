import { Module } from '@nestjs/common';
import { CourseContentService } from './course-content.service';
import { CoursePublicationService } from './course-publication.service';
import {
  CourseModulesController,
  CoursePublicationController,
  CoursesController,
  LessonsController,
  ModuleLessonsController,
  ModulesController,
} from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  controllers: [
    CoursesController,
    CoursePublicationController,
    CourseModulesController,
    ModulesController,
    ModuleLessonsController,
    LessonsController,
  ],
  providers: [CoursesService, CourseContentService, CoursePublicationService],
  exports: [CoursesService, CourseContentService],
})
export class CoursesModule {}
