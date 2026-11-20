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
  ApiNotFoundResponse,
  ApiNotImplementedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import type { Paginated } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Authorize, CurrentUser } from '../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../roles/rbac.constants';
import {
  CreateEmbeddingConfigurationDto,
  EmbeddingConfigurationResponseDto,
} from './dto/embedding-configuration.dto';
import {
  CreateGlossaryTermDto,
  GlossaryListResponseDto,
  GlossaryTermResponseDto,
  ListGlossaryQueryDto,
  UpdateGlossaryTermDto,
} from './dto/glossary.dto';
import { KnowledgeSearchQueryDto, KnowledgeSearchResponseDto } from './dto/knowledge-search.dto';
import {
  CreateKnowledgeTopicDto,
  KnowledgeTopicResponseDto,
  ListKnowledgeTopicsQueryDto,
  UpdateKnowledgeTopicDto,
} from './dto/knowledge-topic.dto';
import { EmbeddingConfigurationsService } from './embeddings/embedding-configurations.service';
import { GlossaryService } from './glossary/glossary.service';
import { KnowledgeSearchService } from './search/knowledge-search.service';
import { KnowledgeTopicsService } from './topics/knowledge-topics.service';

const readers = {
  roles: [RoleCode.Admin, RoleCode.Facilitator],
  permissions: [Permission.KnowledgeRead],
};
const manage = { roles: [RoleCode.Admin], permissions: [Permission.KnowledgeManage] };

@ApiTags('Knowledge topics')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('knowledge/topics')
export class KnowledgeTopicsController {
  constructor(private readonly topics: KnowledgeTopicsService) {}

  @Get()
  @Authorize(readers)
  @ApiOperation({
    summary: 'List agricultural topics',
    description: 'Facilitators see active topics.',
  })
  @ApiOkResponse({ type: KnowledgeTopicResponseDto, isArray: true })
  list(
    @Query() query: ListKnowledgeTopicsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeTopicResponseDto[]> {
    return this.topics.list(query, actor);
  }

  @Post()
  @Authorize(manage)
  @ApiOperation({ summary: 'Create a topic', description: '**Admin only.**' })
  @ApiCreatedResponse({ type: KnowledgeTopicResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Code or name already used' })
  create(
    @Body() dto: CreateKnowledgeTopicDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeTopicResponseDto> {
    return this.topics.create(dto, actor);
  }

  @Patch(':id')
  @Authorize(manage)
  @ApiOperation({
    summary: 'Update a topic',
    description: 'The code cannot change. **Admin only.**',
  })
  @ApiOkResponse({ type: KnowledgeTopicResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Topic not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeTopicDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeTopicResponseDto> {
    return this.topics.update(id, dto, actor);
  }

  @Delete(':id')
  @Authorize(manage)
  @ApiOperation({
    summary: 'Deactivate a topic',
    description: 'Topics are kept for existing sources. **Admin only.**',
  })
  @ApiOkResponse({ type: KnowledgeTopicResponseDto })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeTopicResponseDto> {
    return this.topics.deactivate(id, actor);
  }
}

@ApiTags('Agricultural glossary')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('knowledge/glossary')
export class GlossaryController {
  constructor(private readonly glossary: GlossaryService) {}

  @Get()
  @Authorize(readers)
  @ApiOperation({
    summary: 'Search the bilingual glossary',
    description:
      'Matches English and Kinyarwanda terms, synonyms and descriptions. Facilitators see active terms.',
  })
  @ApiOkResponse({ type: GlossaryListResponseDto })
  list(
    @Query() query: ListGlossaryQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<GlossaryTermResponseDto>> {
    return this.glossary.list(query, actor);
  }

  @Post()
  @Authorize(manage)
  @ApiOperation({
    summary: 'Add a glossary term',
    description: 'Both languages are entered by an administrator. **Admin only.**',
  })
  @ApiCreatedResponse({ type: GlossaryTermResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Term pair already exists' })
  create(
    @Body() dto: CreateGlossaryTermDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GlossaryTermResponseDto> {
    return this.glossary.create(dto, actor);
  }

  @Get(':id')
  @Authorize(readers)
  @ApiOperation({ summary: 'Get a glossary term' })
  @ApiOkResponse({ type: GlossaryTermResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Term not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GlossaryTermResponseDto> {
    return this.glossary.findOne(id, actor);
  }

  @Patch(':id')
  @Authorize(manage)
  @ApiOperation({ summary: 'Update a glossary term', description: '**Admin only.**' })
  @ApiOkResponse({ type: GlossaryTermResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGlossaryTermDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GlossaryTermResponseDto> {
    return this.glossary.update(id, dto, actor);
  }

  @Delete(':id')
  @Authorize(manage)
  @ApiOperation({ summary: 'Deactivate a glossary term', description: '**Admin only.**' })
  @ApiOkResponse({ type: GlossaryTermResponseDto })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GlossaryTermResponseDto> {
    return this.glossary.deactivate(id, actor);
  }
}

@ApiTags('Knowledge search')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('knowledge/search')
export class KnowledgeSearchController {
  constructor(private readonly search: KnowledgeSearchService) {}

  @Get()
  @Authorize(readers)
  @ApiOperation({
    summary: 'Search knowledge',
    description:
      'Metadata mode filters sources by title, crop, topic, language, type, status (admin) and publication date. Semantic mode searches approved chunks by vector similarity and returns 501 until an embedding provider and vector store are configured.',
  })
  @ApiOkResponse({ type: KnowledgeSearchResponseDto })
  @ApiNotImplementedResponse({
    type: ErrorResponseDto,
    description: 'Semantic search is not configured',
  })
  find(
    @Query() query: KnowledgeSearchQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeSearchResponseDto> {
    return this.search.search(query, actor);
  }
}

@ApiTags('Embedding configurations')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('knowledge/embedding-configurations')
export class EmbeddingConfigurationsController {
  constructor(private readonly configurations: EmbeddingConfigurationsService) {}

  @Get()
  @Authorize(manage)
  @ApiOperation({ summary: 'List embedding configurations', description: '**Admin only.**' })
  @ApiOkResponse({ type: EmbeddingConfigurationResponseDto, isArray: true })
  list(): Promise<EmbeddingConfigurationResponseDto[]> {
    return this.configurations.list();
  }

  @Post()
  @Authorize(manage)
  @ApiOperation({
    summary: 'Describe an embedding model',
    description:
      'Created inactive. No model is called; vectors need a registered provider. **Admin only.**',
  })
  @ApiCreatedResponse({ type: EmbeddingConfigurationResponseDto })
  create(
    @Body() dto: CreateEmbeddingConfigurationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EmbeddingConfigurationResponseDto> {
    return this.configurations.create(dto, actor);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Authorize(manage)
  @ApiOperation({
    summary: 'Activate a configuration',
    description: 'Deactivates any other configuration. **Admin only.**',
  })
  @ApiOkResponse({ type: EmbeddingConfigurationResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EmbeddingConfigurationResponseDto> {
    return this.configurations.activate(id, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Authorize(manage)
  @ApiOperation({ summary: 'Deactivate a configuration', description: '**Admin only.**' })
  @ApiOkResponse({ type: EmbeddingConfigurationResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EmbeddingConfigurationResponseDto> {
    return this.configurations.deactivate(id, actor);
  }
}
