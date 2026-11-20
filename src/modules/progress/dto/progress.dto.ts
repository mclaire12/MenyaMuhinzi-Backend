import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  ContentStatus,
  Language,
  LearningChannel,
  LearningSessionStatus,
  LessonProgressStatus,
  LessonType,
} from '../../../generated/prisma/client';
import { LessonResourceResponseDto } from '../../courses/dto/lesson-resource.dto';

export class UpdateLessonProgressDto {
  @ApiProperty({ minimum: 0, maximum: 100, description: 'Whole number. The server derives the status and rejects a lower value.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progressPercentage: number;

  @ApiPropertyOptional({
    enum: LessonProgressStatus,
    description: 'Optional. Rejected when it does not match the percentage.',
  })
  @IsOptional()
  @IsEnum(LessonProgressStatus)
  status?: LessonProgressStatus;

  @ApiPropertyOptional({ enum: LearningChannel })
  @IsOptional()
  @IsEnum(LearningChannel)
  channel?: LearningChannel;
}

export class StartLearningSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  lessonId: string;

  @ApiProperty({ enum: LearningChannel, description: 'WEB, USSD, IVR, or MOBILE. Progress stays on the same farmer account.' })
  @IsEnum(LearningChannel)
  channel: LearningChannel;
}

export class LessonProgressResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ format: 'uuid' })
  moduleId: string;

  @ApiProperty({ format: 'uuid' })
  lessonId: string;

  @ApiProperty({ enum: LessonProgressStatus })
  status: LessonProgressStatus;

  @ApiProperty({ example: 40 })
  progressPercentage: number;

  @ApiProperty({ description: 'Seconds recorded from learning sessions' })
  timeSpentSeconds: number;

  @ApiPropertyOptional({ nullable: true, type: Date })
  startedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  lastAccessedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  completedAt: Date | null;

  @ApiPropertyOptional({ enum: LearningChannel, nullable: true })
  lastChannel: LearningChannel | null;
}

export class ModuleProgressDto {
  @ApiProperty({ format: 'uuid' })
  moduleId: string;

  @ApiProperty()
  totalLessons: number;

  @ApiProperty()
  completedLessons: number;

  @ApiProperty()
  completionPercentage: number;

  @ApiProperty()
  completed: boolean;
}

export class CourseProgressResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty()
  totalModules: number;

  @ApiProperty()
  completedModules: number;

  @ApiProperty()
  totalLessons: number;

  @ApiProperty()
  completedLessons: number;

  @ApiProperty()
  overallCompletionPercentage: number;

  @ApiProperty()
  totalLearningTimeSeconds: number;

  @ApiProperty({ enum: LessonProgressStatus })
  courseCompletionStatus: LessonProgressStatus;

  @ApiProperty({ type: ModuleProgressDto, isArray: true })
  modules: ModuleProgressDto[];

  @ApiProperty({ type: LessonProgressResponseDto, isArray: true })
  lessons: LessonProgressResponseDto[];
}

export class LearningSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ format: 'uuid' })
  lessonId: string;

  @ApiProperty({ enum: LearningChannel })
  channel: LearningChannel;

  @ApiProperty({ enum: LearningSessionStatus })
  status: LearningSessionStatus;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  endedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  durationSeconds: number | null;
}

export class LessonContentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  moduleId: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ isArray: true, type: String })
  learningObjectives: string[];

  @ApiProperty({ enum: LessonType })
  lessonType: LessonType;

  @ApiPropertyOptional({ nullable: true, type: String })
  mainContent: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  contentRef: string | null;

  @ApiProperty({ enum: Language })
  language: Language;

  @ApiProperty()
  estimatedDurationMinutes: number;

  @ApiProperty()
  displayOrder: number;

  @ApiProperty({ enum: ContentStatus })
  status: ContentStatus;

  @ApiProperty({ type: LessonResourceResponseDto, isArray: true })
  resources: LessonResourceResponseDto[];
}
