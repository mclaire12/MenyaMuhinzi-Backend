import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import {
  AssessmentStatus,
  AttemptStatus,
  Language,
  QuestionType,
} from '../../../generated/prisma/client';

export class CreateQuestionDto {
  @ApiProperty({ maxLength: 2000 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;

  @ApiProperty({ enum: QuestionType })
  @IsEnum(QuestionType)
  questionType: QuestionType;

  @ApiPropertyOptional({ type: String, isArray: true, minItems: 2, maxItems: 8, description: 'Required for multiple choice' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(500, { each: true })
  options?: string[];

  @ApiPropertyOptional({ minimum: 0, description: 'Index into options. Required for multiple choice.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  correctOptionIndex?: number;

  @ApiPropertyOptional({ description: 'Required for true/false' })
  @IsOptional()
  @IsBoolean()
  correctBoolean?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  marks?: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  explanation?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}

export class CreateAssessmentDto {
  @ApiProperty({ maxLength: 200 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Set exactly one of courseId, moduleId, or lessonId' })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  moduleId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonId?: string;

  @ApiProperty({ minimum: 0, maximum: 100, description: 'Percentage required to pass' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  passingScore: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 600, description: 'Minutes. Omitted means no limit.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  timeLimitMinutes?: number;

  @ApiPropertyOptional({ enum: Language, default: Language.rw })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ enum: AssessmentStatus, default: AssessmentStatus.DRAFT })
  @IsOptional()
  @IsEnum(AssessmentStatus)
  status?: AssessmentStatus;

  @ApiPropertyOptional({ type: CreateQuestionDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions?: CreateQuestionDto[];
}

export class UpdateAssessmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  passingScore?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 600 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  timeLimitMinutes?: number | null;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ enum: AssessmentStatus })
  @IsOptional()
  @IsEnum(AssessmentStatus)
  status?: AssessmentStatus;
}

export class ListAssessmentsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  moduleId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonId?: string;
}

export class QuestionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  text: string;

  @ApiProperty({ enum: QuestionType })
  questionType: QuestionType;

  @ApiPropertyOptional({ nullable: true, description: 'Option id and text. The correct option is hidden until an attempt is submitted.' })
  options: { id: string; text: string }[] | null;

  @ApiProperty()
  marks: number;

  @ApiProperty()
  displayOrder: number;

  @ApiPropertyOptional({ description: 'Present for administrators, facilitators, and submitted attempts' })
  correctAnswer?: unknown;

  @ApiPropertyOptional({ nullable: true, type: String })
  explanation?: string | null;
}

export class AssessmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  courseId: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  moduleId: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  lessonId: string | null;

  @ApiProperty()
  passingScore: number;

  @ApiProperty()
  maxAttempts: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  timeLimitMinutes: number | null;

  @ApiProperty({ enum: Language })
  language: Language;

  @ApiProperty({ enum: AssessmentStatus })
  status: AssessmentStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: QuestionResponseDto, isArray: true })
  questions: QuestionResponseDto[];
}

export class SubmitAnswerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  questionId: string;

  @ApiPropertyOptional({ description: 'Multiple-choice option id' })
  @IsOptional()
  @IsUUID()
  selectedOptionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  booleanAnswer?: boolean;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(5000)
  textAnswer?: string;
}

export class SubmitAttemptDto {
  @ApiProperty({ type: SubmitAnswerDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers: SubmitAnswerDto[];
}

export class ReviewGradeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  questionId: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  awardedMarks: number;
}

export class ReviewAttemptDto {
  @ApiProperty({ type: ReviewGradeDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReviewGradeDto)
  grades: ReviewGradeDto[];
}

export class AttemptAnswerResponseDto {
  @ApiProperty({ format: 'uuid' })
  questionId: string;

  @ApiProperty()
  response: unknown;

  @ApiPropertyOptional({ nullable: true, type: Number })
  awardedMarks: number | null;

  @ApiPropertyOptional()
  correctAnswer?: unknown;

  @ApiPropertyOptional({ nullable: true, type: String })
  explanation?: string | null;
}

export class AttemptResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  assessmentId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  attemptNumber: number;

  @ApiProperty({ enum: AttemptStatus })
  status: AttemptStatus;

  @ApiPropertyOptional({ nullable: true, type: Number })
  score: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  maxScore: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  percentage: number | null;

  @ApiPropertyOptional({ nullable: true, type: Boolean })
  passed: boolean | null;

  @ApiProperty()
  timedOut: boolean;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  submittedAt: Date | null;

  @ApiPropertyOptional({ type: AttemptAnswerResponseDto, isArray: true })
  answers?: AttemptAnswerResponseDto[];
}

export class ListAttemptsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assessmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class AttemptListResponseDto {
  @ApiProperty({ type: AttemptResponseDto, isArray: true })
  data: AttemptResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
