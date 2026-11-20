import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import type { Paginated } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Authorize, CurrentUser } from '../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../roles/rbac.constants';
import { AssessmentsService } from './assessments.service';
import {
  AssessmentResponseDto,
  AttemptListResponseDto,
  AttemptResponseDto,
  CreateAssessmentDto,
  CreateQuestionDto,
  ListAssessmentsQueryDto,
  ListAttemptsQueryDto,
  QuestionResponseDto,
  ReviewAttemptDto,
  SubmitAttemptDto,
  UpdateAssessmentDto,
} from './dto/assessment.dto';

const readers = [
  RoleCode.Admin,
  RoleCode.Facilitator,
  RoleCode.SmartphoneFarmer,
  RoleCode.BasicPhoneFarmer,
];
const farmers = [RoleCode.SmartphoneFarmer, RoleCode.BasicPhoneFarmer];

@ApiTags('Assessments')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller()
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Post('assessments')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.AssessmentsManage] })
  @ApiOperation({
    summary: 'Create an assessment',
    description:
      'Attach it to exactly one course, module, or lesson. Correct answers are stored and are not returned to farmers before they submit. **Admin only.**',
  })
  @ApiCreatedResponse({ type: AssessmentResponseDto })
  create(
    @Body() dto: CreateAssessmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AssessmentResponseDto> {
    return this.assessments.create(dto, actor);
  }

  @Get('assessments')
  @Authorize({ roles: readers, permissions: [Permission.AssessmentsRead] })
  @ApiOperation({
    summary: 'List assessments',
    description:
      'Filter by one parent. Farmers see published assessments and never receive correct answers.',
  })
  @ApiOkResponse({ type: AssessmentResponseDto, isArray: true })
  list(
    @Query() query: ListAssessmentsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AssessmentResponseDto[]> {
    return this.assessments.list(query, actor);
  }

  @Get('assessments/:id')
  @Authorize({ roles: readers, permissions: [Permission.AssessmentsRead] })
  @ApiOperation({
    summary: 'Get an assessment',
    description: 'Correct answers are hidden from farmers.',
  })
  @ApiOkResponse({ type: AssessmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Assessment not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AssessmentResponseDto> {
    return this.assessments.findOne(id, actor);
  }

  @Patch('assessments/:id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.AssessmentsManage] })
  @ApiOperation({
    summary: 'Update an assessment',
    description: 'Publishing requires at least one question. **Admin only.**',
  })
  @ApiOkResponse({ type: AssessmentResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssessmentDto,
  ): Promise<AssessmentResponseDto> {
    return this.assessments.update(id, dto);
  }

  @Post('assessments/:id/questions')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.AssessmentsManage] })
  @ApiOperation({ summary: 'Add a question', description: '**Admin only.**' })
  @ApiCreatedResponse({ type: QuestionResponseDto })
  addQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuestionDto,
  ): Promise<QuestionResponseDto> {
    return this.assessments.addQuestion(id, dto);
  }

  @Patch('assessment-questions/:id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.AssessmentsManage] })
  @ApiOperation({ summary: 'Replace a question', description: '**Admin only.**' })
  @ApiOkResponse({ type: QuestionResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Question not found' })
  updateQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuestionDto,
  ): Promise<QuestionResponseDto> {
    return this.assessments.updateQuestion(id, dto);
  }

  @Delete('assessment-questions/:id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.AssessmentsManage] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a question that has not been answered',
    description: '**Admin only.**',
  })
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Question has answers' })
  removeQuestion(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.assessments.removeQuestion(id);
  }

  @Post('assessments/:id/attempts')
  @Authorize({ roles: farmers, permissions: [Permission.AssessmentsAttempt] })
  @ApiOperation({
    summary: 'Start an assessment attempt',
    description:
      'Requires an active or completed enrollment. An open attempt and the maximum number of attempts are enforced. **Farmer.**',
  })
  @ApiCreatedResponse({ type: AttemptResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'An attempt is open, or the maximum was reached',
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Not enrolled' })
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AttemptResponseDto> {
    return this.assessments.start(id, actor);
  }

  @Post('assessment-attempts/:id/submit')
  @HttpCode(HttpStatus.OK)
  @Authorize({ roles: farmers, permissions: [Permission.AssessmentsAttempt] })
  @ApiOperation({
    summary: 'Submit an attempt',
    description:
      'Multiple choice and true/false are scored on the server. Short answers are stored for review and do not pass the attempt by themselves. A time limit that has passed cannot produce a pass.',
  })
  @ApiOkResponse({ type: AttemptResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Attempt is already submitted' })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAttemptDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AttemptResponseDto> {
    return this.assessments.submit(id, dto, actor);
  }

  @Get('assessment-attempts')
  @Authorize({ roles: readers, permissions: [Permission.AssessmentsRead] })
  @ApiOperation({
    summary: 'List assessment attempts',
    description:
      'Farmers see their own attempts. Facilitators see attempts by members of their groups.',
  })
  @ApiOkResponse({ type: AttemptListResponseDto })
  listAttempts(
    @Query() query: ListAttemptsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<AttemptResponseDto>> {
    return this.assessments.listAttempts(query, actor);
  }

  @Get('assessment-attempts/:id')
  @Authorize({ roles: readers, permissions: [Permission.AssessmentsRead] })
  @ApiOperation({
    summary: 'Get an attempt',
    description: 'Correct answers are included after the attempt is submitted.',
  })
  @ApiOkResponse({ type: AttemptResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Attempt not found' })
  findAttempt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AttemptResponseDto> {
    return this.assessments.findAttempt(id, actor);
  }

  @Post('assessment-attempts/:id/review')
  @HttpCode(HttpStatus.OK)
  @Authorize({
    roles: [RoleCode.Admin, RoleCode.Facilitator],
    permissions: [Permission.AssessmentsReview],
  })
  @ApiOperation({
    summary: 'Review short answers',
    description:
      'Scores are checked against each question. Facilitators can review members of their own groups. **Admin or facilitator.**',
  })
  @ApiOkResponse({ type: AttemptResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Attempt is not waiting for review' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAttemptDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AttemptResponseDto> {
    return this.assessments.review(id, dto, actor);
  }
}
