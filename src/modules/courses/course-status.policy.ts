import { BadRequestException, ConflictException } from '@nestjs/common';
import { CourseGenerationStatus, CourseStatus } from '../../generated/prisma/client';

/** Status changes made through PATCH. Publishing has its own endpoint. */
export function assertCourseStatusChange(from: CourseStatus, to: CourseStatus): void {
  if (to === CourseStatus.PUBLISHED) {
    throw new BadRequestException('Use the publish endpoint to publish a course');
  }
  if (from === to) throw new ConflictException(`Course is already ${to}`);
  if (from === CourseStatus.ARCHIVED && to !== CourseStatus.DRAFT) {
    throw new ConflictException('An archived course can only be returned to draft');
  }
  if (to === CourseStatus.UNDER_REVIEW && from !== CourseStatus.DRAFT) {
    throw new ConflictException('Only a draft course can be submitted for review');
  }
  if (to === CourseStatus.DRAFT && from === CourseStatus.PUBLISHED) {
    throw new ConflictException('Unpublish the course to return it to draft');
  }
}

export function assertCanPublish(status: CourseStatus): void {
  if (status === CourseStatus.PUBLISHED) throw new ConflictException('Course is already published');
  if (status === CourseStatus.ARCHIVED) throw new ConflictException('Archived courses cannot be published');
}

export function assertCanDeleteCourse(status: CourseStatus): void {
  if (status === CourseStatus.PUBLISHED) {
    throw new ConflictException('Unpublish the course before deleting it');
  }
  if (status === CourseStatus.ARCHIVED) {
    throw new ConflictException('Archived courses are kept for their publication history');
  }
}

/** The AI is still writing the course: it cannot be published or shared yet. */
export function assertGenerationFinished(generation: { status: CourseGenerationStatus } | null): void {
  if (
    generation &&
    (generation.status === CourseGenerationStatus.PENDING ||
      generation.status === CourseGenerationStatus.PROCESSING)
  ) {
    throw new ConflictException('The AI has not finished writing this course yet');
  }
}
