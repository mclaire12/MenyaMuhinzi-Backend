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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { Authorize, CurrentUser } from '../../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../../roles/rbac.constants';
import {
  AddKnowledgeVersionDto,
  ApproveSourceDto,
  CreateKnowledgeSourceDto,
  KnowledgeChunkListResponseDto,
  KnowledgeChunkResponseDto,
  KnowledgeSourceListResponseDto,
  KnowledgeSourceResponseDto,
  ListChunksQueryDto,
  ListKnowledgeSourcesQueryDto,
  ProcessingStatusResponseDto,
  ProcessResponseDto,
  ProcessSourceDto,
  RejectSourceDto,
  SourceHistoryResponseDto,
  UpdateKnowledgeSourceDto,
} from '../dto/knowledge-source.dto';
import { KnowledgeReviewService } from './knowledge-review.service';
import { KnowledgeSourcesService, type UploadedDocument } from './knowledge-sources.service';

const readers = [RoleCode.Admin, RoleCode.Facilitator];
const manage = { roles: [RoleCode.Admin], permissions: [Permission.KnowledgeManage] };
const approve = { roles: [RoleCode.Admin], permissions: [Permission.KnowledgeApprove] };

@ApiTags('Knowledge sources')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller()
export class KnowledgeSourcesController {
  constructor(
    private readonly sources: KnowledgeSourcesService,
    private readonly review: KnowledgeReviewService,
  ) {}

  @Post('knowledge/sources')
  @Authorize(manage)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: CreateKnowledgeSourceDto })
  @ApiOperation({
    summary: 'Register a knowledge source',
    description:
      'Upload a PDF, DOCX, TXT or HTML file (multipart field `file`) or give a `storageRef`. The file type is detected from its content; executables are refused. Creates version 1 in DRAFT. **Admin only.**',
  })
  @ApiCreatedResponse({ type: KnowledgeSourceResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'File type, extension or content is not accepted',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponseDto,
    description: 'File is larger than KNOWLEDGE_MAX_FILE_BYTES',
  })
  create(
    @Body() dto: CreateKnowledgeSourceDto,
    @UploadedFile() file: UploadedDocument | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.sources.create(dto, file, actor);
  }

  @Get('knowledge/sources')
  @Authorize({ roles: readers, permissions: [Permission.KnowledgeRead] })
  @ApiOperation({
    summary: 'List knowledge sources',
    description: 'Administrators see every source. Facilitators only see approved, active sources.',
  })
  @ApiOkResponse({ type: KnowledgeSourceListResponseDto })
  list(
    @Query() query: ListKnowledgeSourcesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<KnowledgeSourceResponseDto>> {
    return this.sources.list(query, actor);
  }

  @Get('knowledge/sources/:id')
  @Authorize({ roles: readers, permissions: [Permission.KnowledgeRead] })
  @ApiOperation({
    summary: 'Get a knowledge source',
    description: 'Administrators also receive every version.',
  })
  @ApiOkResponse({ type: KnowledgeSourceResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Source not found or not approved' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.sources.findOne(id, actor);
  }

  @Patch('knowledge/sources/:id')
  @Authorize(manage)
  @ApiOperation({
    summary: 'Update source metadata',
    description:
      'Changing crops or topics re-tags existing chunks. File content changes need a new version. **Admin only.**',
  })
  @ApiOkResponse({ type: KnowledgeSourceResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Source is archived' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeSourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.sources.update(id, dto, actor);
  }

  @Delete('knowledge/sources/:id')
  @Authorize(manage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a source that was never approved',
    description:
      'Removes the source, its versions and stored files. Sources with approved knowledge must be archived. **Admin only.**',
  })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Source has approved knowledge or is processing',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.sources.remove(id, actor);
  }

  @Post('knowledge/sources/:id/activate')
  @HttpCode(HttpStatus.OK)
  @Authorize(manage)
  @ApiOperation({ summary: 'Activate a source', description: '**Admin only.**' })
  @ApiOkResponse({ type: KnowledgeSourceResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.sources.setActive(id, true, actor);
  }

  @Post('knowledge/sources/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Authorize(manage)
  @ApiOperation({
    summary: 'Deactivate a source',
    description: 'Inactive sources are excluded from retrieval. **Admin only.**',
  })
  @ApiOkResponse({ type: KnowledgeSourceResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.sources.setActive(id, false, actor);
  }

  @Post('knowledge/sources/:id/versions')
  @Authorize(manage)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: AddKnowledgeVersionDto })
  @ApiOperation({
    summary: 'Add a new version',
    description:
      'Needed to re-process content. The approved version stays in use until the new version is approved. The same file cannot be added twice. **Admin only.**',
  })
  @ApiCreatedResponse({ type: KnowledgeSourceResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Latest version is processing or under review, or the file is a duplicate',
  })
  addVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddKnowledgeVersionDto,
    @UploadedFile() file: UploadedDocument | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.sources.addVersion(id, dto, file, actor);
  }

  @Post('knowledge/sources/:id/process')
  @HttpCode(HttpStatus.ACCEPTED)
  @Authorize(manage)
  @ApiOperation({
    summary: 'Process a version',
    description:
      'Queues extraction, normalization, metadata and chunking. Allowed for DRAFT or FAILED versions only; processed content needs a new version. **Admin only.**',
  })
  @ApiAcceptedResponse({ type: ProcessResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Already processing or processed, or the type cannot be processed',
  })
  process(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProcessSourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ProcessResponseDto> {
    return this.sources.process(id, dto.versionId, actor);
  }

  @Get('knowledge/sources/:id/processing-status')
  @Authorize(manage)
  @ApiOperation({
    summary: 'Processing status of a version',
    description: 'Defaults to the latest version. **Admin only.**',
  })
  @ApiOkResponse({ type: ProcessingStatusResponseDto })
  processingStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ProcessSourceDto,
  ): Promise<ProcessingStatusResponseDto> {
    return this.sources.processingStatus(id, query.versionId);
  }

  @Get('knowledge/sources/:id/history')
  @Authorize(manage)
  @ApiOperation({
    summary: 'Version, approval, processing and audit history',
    description: '**Admin only.**',
  })
  @ApiOkResponse({ type: SourceHistoryResponseDto })
  history(@Param('id', ParseUUIDPipe) id: string): Promise<SourceHistoryResponseDto> {
    return this.sources.history(id);
  }

  @Post('knowledge/sources/:id/submit-review')
  @HttpCode(HttpStatus.OK)
  @Authorize(manage)
  @ApiOperation({
    summary: 'Submit the processed version for review',
    description: '**Admin only.**',
  })
  @ApiOkResponse({ type: KnowledgeSourceResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Latest version is not processed' })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.review.submit(id, actor);
  }

  @Post('knowledge/sources/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Authorize(approve)
  @ApiOperation({
    summary: 'Approve the version under review',
    description:
      'The previously approved version is archived and kept. Only approved knowledge is eligible for retrieval. **Admin only.**',
  })
  @ApiOkResponse({ type: KnowledgeSourceResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'No version is waiting for review' })
  approveSource(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveSourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.review.approve(id, dto.reason, actor);
  }

  @Post('knowledge/sources/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Authorize(approve)
  @ApiOperation({
    summary: 'Reject the version under review',
    description: 'A reason is required. **Admin only.**',
  })
  @ApiOkResponse({ type: KnowledgeSourceResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'No version is waiting for review' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectSourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.review.reject(id, dto.reason, actor);
  }

  @Post('knowledge/sources/:id/archive')
  @HttpCode(HttpStatus.OK)
  @Authorize(approve)
  @ApiOperation({
    summary: 'Archive a source',
    description: 'Removes it from retrieval and keeps all versions and history. **Admin only.**',
  })
  @ApiOkResponse({ type: KnowledgeSourceResponseDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveSourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    return this.review.archive(id, dto.reason, actor);
  }

  @Get('knowledge/sources/:id/chunks')
  @Authorize({ roles: readers, permissions: [Permission.KnowledgeRead] })
  @ApiOperation({
    summary: 'List chunks of a source',
    description:
      'Facilitators only see chunks of the approved version. Administrators can pick any version.',
  })
  @ApiOkResponse({ type: KnowledgeChunkListResponseDto })
  listChunks(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListChunksQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<KnowledgeChunkResponseDto>> {
    return this.sources.listChunks(id, query, actor);
  }

  @Get('knowledge/chunks/:id')
  @Authorize({ roles: readers, permissions: [Permission.KnowledgeRead] })
  @ApiOperation({ summary: 'Get a chunk', description: 'Facilitators only see approved chunks.' })
  @ApiOkResponse({ type: KnowledgeChunkResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Chunk not found or not approved' })
  findChunk(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeChunkResponseDto> {
    return this.sources.findChunk(id, actor);
  }
}
