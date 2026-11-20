import { BadRequestException, ConflictException } from '@nestjs/common';
import { CourseStatus } from '../../generated/prisma/client';
import { assertCanDeleteCourse, assertCanPublish, assertCourseStatusChange } from './course-status.policy';

describe('course status policy', () => {
  it('lets a draft move to review or archive, and an archived course return to draft', () => {
    expect(() => assertCourseStatusChange(CourseStatus.DRAFT, CourseStatus.UNDER_REVIEW)).not.toThrow();
    expect(() => assertCourseStatusChange(CourseStatus.DRAFT, CourseStatus.ARCHIVED)).not.toThrow();
    expect(() => assertCourseStatusChange(CourseStatus.ARCHIVED, CourseStatus.DRAFT)).not.toThrow();
    expect(() => assertCourseStatusChange(CourseStatus.PUBLISHED, CourseStatus.ARCHIVED)).not.toThrow();
  });

  it('refuses to publish through the status field', () => {
    expect(() => assertCourseStatusChange(CourseStatus.DRAFT, CourseStatus.PUBLISHED)).toThrow(BadRequestException);
  });

  it('refuses to unpublish through the status field', () => {
    expect(() => assertCourseStatusChange(CourseStatus.PUBLISHED, CourseStatus.DRAFT)).toThrow(ConflictException);
  });

  it('publishes drafts and courses under review, not published or archived courses', () => {
    expect(() => assertCanPublish(CourseStatus.DRAFT)).not.toThrow();
    expect(() => assertCanPublish(CourseStatus.UNDER_REVIEW)).not.toThrow();
    expect(() => assertCanPublish(CourseStatus.PUBLISHED)).toThrow(/already published/);
    expect(() => assertCanPublish(CourseStatus.ARCHIVED)).toThrow(/Archived/);
  });

  it('deletes only unpublished drafts and courses under review', () => {
    expect(() => assertCanDeleteCourse(CourseStatus.DRAFT)).not.toThrow();
    expect(() => assertCanDeleteCourse(CourseStatus.UNDER_REVIEW)).not.toThrow();
    expect(() => assertCanDeleteCourse(CourseStatus.PUBLISHED)).toThrow(/Unpublish/);
    expect(() => assertCanDeleteCourse(CourseStatus.ARCHIVED)).toThrow(/history/);
  });
});
