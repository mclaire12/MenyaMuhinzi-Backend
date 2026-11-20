import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { Authorize, CurrentUser } from '../../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../../roles/rbac.constants';
import { AiAssistantsService } from '../assistants/ai-assistants.service';
import {
  AiAssistantListResponseDto,
  AiAssistantResponseDto,
  CreateAiAssistantDto,
  ListAiAssistantsQueryDto,
  SetAssistantPromptsDto,
  UpdateAiAssistantDto,
} from '../dto/assistant.dto';
import { ConfigurationHistoryDto } from '../dto/common.dto';
import {
  AiModelListResponseDto,
  AiModelResponseDto,
  CreateAiModelDto,
  CreateModelConfigurationDto,
  ListAiModelsQueryDto,
  ListModelConfigurationsQueryDto,
  ModelConfigurationListResponseDto,
  ModelConfigurationResponseDto,
  UpdateAiModelDto,
} from '../dto/model.dto';
import { AiModelConfigurationsService } from '../models/ai-model-configurations.service';
import { AiModelsService } from '../models/ai-models.service';

const admin = (permission: Permission) => ({ roles: [RoleCode.Admin], permissions: [permission] });

@ApiTags('AI admin: assistants')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/ai/assistants')
export class AdminAiAssistantsController {
  constructor(private readonly assistants: AiAssistantsService) {}

  @Get()
  @Authorize(admin(Permission.AiAssistantsRead))
  @ApiOperation({ summary: 'List assistants', description: '**Admin only.**' })
  @ApiOkResponse({ type: AiAssistantListResponseDto })
  list(@Query() query: ListAiAssistantsQueryDto): Promise<Paginated<AiAssistantResponseDto>> {
    return this.assistants.list(query);
  }

  @Post()
  @Authorize(admin(Permission.AiAssistantsManage))
  @ApiOperation({
    summary: 'Create an assistant',
    description: 'Created as DRAFT; it is not usable until activated. **Admin only.**',
  })
  @ApiCreatedResponse({ type: AiAssistantResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Code already used' })
  create(
    @Body() dto: CreateAiAssistantDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    return this.assistants.create(dto, actor);
  }

  @Get(':id')
  @Authorize(admin(Permission.AiAssistantsRead))
  @ApiOperation({ summary: 'Get an assistant', description: '**Admin only.**' })
  @ApiOkResponse({ type: AiAssistantResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Assistant not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AiAssistantResponseDto> {
    return this.assistants.findOne(id);
  }

  @Patch(':id')
  @Authorize(admin(Permission.AiAssistantsManage))
  @ApiOperation({
    summary: 'Update an assistant',
    description: 'Each change adds a configuration version. **Admin only.**',
  })
  @ApiOkResponse({ type: AiAssistantResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Assistant is archived' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiAssistantDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    return this.assistants.update(id, dto, actor);
  }

  @Put(':id/prompts')
  @Authorize(admin(Permission.AiAssistantsManage))
  @ApiOperation({
    summary: 'Set the prompt templates used by an assistant',
    description: 'Replaces the list. Unpinned templates use their default version. **Admin only.**',
  })
  @ApiOkResponse({ type: AiAssistantResponseDto })
  setPrompts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAssistantPromptsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    return this.assistants.setPrompts(id, dto, actor);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiAssistantsManage))
  @ApiOperation({ summary: 'Activate an assistant', description: '**Admin only.**' })
  @ApiOkResponse({ type: AiAssistantResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Assistant is archived' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    return this.assistants.activate(id, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiAssistantsManage))
  @ApiOperation({
    summary: 'Deactivate an assistant',
    description: 'Users can no longer start or continue conversations. **Admin only.**',
  })
  @ApiOkResponse({ type: AiAssistantResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    return this.assistants.deactivate(id, actor);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiAssistantsManage))
  @ApiOperation({
    summary: 'Archive an assistant',
    description: 'Permanent; history and conversations are kept. **Admin only.**',
  })
  @ApiOkResponse({ type: AiAssistantResponseDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    return this.assistants.archive(id, actor);
  }

  @Get(':id/history')
  @Authorize(admin(Permission.AiAssistantsRead))
  @ApiOperation({
    summary: 'Configuration history',
    description: 'Version snapshots and audit entries. **Admin only.**',
  })
  @ApiOkResponse({ type: ConfigurationHistoryDto })
  history(@Param('id', ParseUUIDPipe) id: string): Promise<ConfigurationHistoryDto> {
    return this.assistants.history(id);
  }
}

@ApiTags('AI admin: models')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/ai/models')
export class AdminAiModelsController {
  constructor(private readonly models: AiModelsService) {}

  @Get()
  @Authorize(admin(Permission.AiModelsRead))
  @ApiOperation({ summary: 'List registered models', description: '**Admin only.**' })
  @ApiOkResponse({ type: AiModelListResponseDto })
  list(@Query() query: ListAiModelsQueryDto): Promise<Paginated<AiModelResponseDto>> {
    return this.models.list(query);
  }

  @Post()
  @Authorize(admin(Permission.AiModelsManage))
  @ApiOperation({
    summary: 'Register a model',
    description:
      'Describes a model; nothing is called. Metadata must not contain credentials and is rejected if it looks like it does. **Admin only.**',
  })
  @ApiCreatedResponse({ type: AiModelResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Provider, name and version already registered',
  })
  register(
    @Body() dto: CreateAiModelDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiModelResponseDto> {
    return this.models.register(dto, actor);
  }

  @Get(':id')
  @Authorize(admin(Permission.AiModelsRead))
  @ApiOperation({ summary: 'Get a model', description: '**Admin only.**' })
  @ApiOkResponse({ type: AiModelResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Model not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AiModelResponseDto> {
    return this.models.findOne(id);
  }

  @Patch(':id')
  @Authorize(admin(Permission.AiModelsManage))
  @ApiOperation({
    summary: 'Update model metadata',
    description: 'Provider, name and version cannot change. **Admin only.**',
  })
  @ApiOkResponse({ type: AiModelResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiModelDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiModelResponseDto> {
    return this.models.update(id, dto, actor);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiModelsManage))
  @ApiOperation({ summary: 'Activate a model', description: '**Admin only.**' })
  @ApiOkResponse({ type: AiModelResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiModelResponseDto> {
    return this.models.activate(id, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiModelsManage))
  @ApiOperation({
    summary: 'Deactivate a model',
    description: 'Rejected while an active model configuration uses it. **Admin only.**',
  })
  @ApiOkResponse({ type: AiModelResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Used by an active configuration' })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiModelResponseDto> {
    return this.models.deactivate(id, actor);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiModelsManage))
  @ApiOperation({
    summary: 'Archive a model',
    description: 'Rejected while an active model configuration uses it. **Admin only.**',
  })
  @ApiOkResponse({ type: AiModelResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Used by an active configuration' })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiModelResponseDto> {
    return this.models.archive(id, actor);
  }

  @Get(':id/history')
  @Authorize(admin(Permission.AiModelsRead))
  @ApiOperation({ summary: 'Model metadata history', description: '**Admin only.**' })
  @ApiOkResponse({ type: ConfigurationHistoryDto })
  history(@Param('id', ParseUUIDPipe) id: string): Promise<ConfigurationHistoryDto> {
    return this.models.history(id);
  }
}

@ApiTags('AI admin: model configurations')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/ai/model-configurations')
export class AdminAiModelConfigurationsController {
  constructor(private readonly configurations: AiModelConfigurationsService) {}

  @Get()
  @Authorize(admin(Permission.AiModelsRead))
  @ApiOperation({ summary: 'List assistant model configurations', description: '**Admin only.**' })
  @ApiOkResponse({ type: ModelConfigurationListResponseDto })
  list(
    @Query() query: ListModelConfigurationsQueryDto,
  ): Promise<Paginated<ModelConfigurationResponseDto>> {
    return this.configurations.list(query);
  }

  @Post()
  @Authorize(admin(Permission.AiModelsManage))
  @ApiOperation({
    summary: 'Create a model configuration version',
    description:
      'Created inactive. Models must offer every required capability and the fallback must differ from the primary. **Admin only.**',
  })
  @ApiCreatedResponse({ type: ModelConfigurationResponseDto })
  create(
    @Body() dto: CreateModelConfigurationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ModelConfigurationResponseDto> {
    return this.configurations.create(dto, actor);
  }

  @Get(':id')
  @Authorize(admin(Permission.AiModelsRead))
  @ApiOperation({ summary: 'Get a model configuration', description: '**Admin only.**' })
  @ApiOkResponse({ type: ModelConfigurationResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Configuration not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ModelConfigurationResponseDto> {
    return this.configurations.findOne(id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiModelsManage))
  @ApiOperation({
    summary: 'Activate a model configuration',
    description:
      "Requires active models with the required capabilities. Deactivates the assistant's previous configuration. **Admin only.**",
  })
  @ApiOkResponse({ type: ModelConfigurationResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'A model is inactive or archived' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ModelConfigurationResponseDto> {
    return this.configurations.activate(id, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiModelsManage))
  @ApiOperation({ summary: 'Deactivate a model configuration', description: '**Admin only.**' })
  @ApiOkResponse({ type: ModelConfigurationResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ModelConfigurationResponseDto> {
    return this.configurations.deactivate(id, actor);
  }
}
