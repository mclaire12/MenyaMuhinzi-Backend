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
import { AiConversationsService } from '../conversations/ai-conversations.service';
import { AiRequestsService } from '../conversations/ai-requests.service';
import {
  AdminAiRequestListResponseDto,
  AdminAiRequestResponseDto,
  AdminListConversationsQueryDto,
  AdminListRequestsQueryDto,
  ConversationDetailResponseDto,
  ConversationListResponseDto,
  ConversationResponseDto,
} from '../dto/conversation.dto';
import {
  CreatePromptTemplateDto,
  CreatePromptVersionDto,
  ListPromptTemplatesQueryDto,
  PromptTemplateListResponseDto,
  PromptTemplateResponseDto,
  PromptVersionResponseDto,
  SetDefaultPromptVersionDto,
  UpdatePromptTemplateDto,
} from '../dto/prompt.dto';
import {
  CreateSafetyPolicyDto,
  ListSafetyPoliciesQueryDto,
  SafetyPolicyListResponseDto,
  SafetyPolicyResponseDto,
  SafetyPolicyVersionResponseDto,
  UpdateSafetyPolicyDto,
} from '../dto/safety-policy.dto';
import {
  UsageFilterQueryDto,
  UsageListResponseDto,
  UsageRecordResponseDto,
  UsageSummaryResponseDto,
} from '../dto/usage.dto';
import { AiPromptsService } from '../prompts/ai-prompts.service';
import { AiSafetyPoliciesService } from '../safety/ai-safety-policies.service';
import { AiUsageService } from '../usage/ai-usage.service';

const admin = (permission: Permission) => ({ roles: [RoleCode.Admin], permissions: [permission] });

@ApiTags('AI admin: prompts')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/ai/prompts')
export class AdminAiPromptsController {
  constructor(private readonly prompts: AiPromptsService) {}

  @Get()
  @Authorize(admin(Permission.AiPromptsRead))
  @ApiOperation({ summary: 'List prompt templates', description: '**Admin only.**' })
  @ApiOkResponse({ type: PromptTemplateListResponseDto })
  list(@Query() query: ListPromptTemplatesQueryDto): Promise<Paginated<PromptTemplateResponseDto>> {
    return this.prompts.list(query);
  }

  @Post()
  @Authorize(admin(Permission.AiPromptsManage))
  @ApiOperation({
    summary: 'Create a prompt template',
    description:
      'Creates version 1 as the default. Text is stored, never executed. **Admin only.**',
  })
  @ApiCreatedResponse({ type: PromptTemplateResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Code already used' })
  create(
    @Body() dto: CreatePromptTemplateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    return this.prompts.create(dto, actor);
  }

  @Get(':id')
  @Authorize(admin(Permission.AiPromptsRead))
  @ApiOperation({ summary: 'Get a prompt template', description: '**Admin only.**' })
  @ApiOkResponse({ type: PromptTemplateResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Template not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PromptTemplateResponseDto> {
    return this.prompts.findOne(id);
  }

  @Patch(':id')
  @Authorize(admin(Permission.AiPromptsManage))
  @ApiOperation({
    summary: 'Update template metadata',
    description: 'Content changes need a new version. **Admin only.**',
  })
  @ApiOkResponse({ type: PromptTemplateResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromptTemplateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    return this.prompts.update(id, dto, actor);
  }

  @Get(':id/versions')
  @Authorize(admin(Permission.AiPromptsRead))
  @ApiOperation({ summary: 'List all versions, newest first', description: '**Admin only.**' })
  @ApiOkResponse({ type: PromptVersionResponseDto, isArray: true })
  versions(@Param('id', ParseUUIDPipe) id: string): Promise<PromptVersionResponseDto[]> {
    return this.prompts.listVersions(id);
  }

  @Post(':id/versions')
  @Authorize(admin(Permission.AiPromptsManage))
  @ApiOperation({
    summary: 'Add a prompt version',
    description: 'Earlier versions are preserved. **Admin only.**',
  })
  @ApiCreatedResponse({ type: PromptVersionResponseDto })
  addVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePromptVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PromptVersionResponseDto> {
    return this.prompts.addVersion(id, dto, actor);
  }

  @Get(':id/versions/:versionId')
  @Authorize(admin(Permission.AiPromptsRead))
  @ApiOperation({ summary: 'Get a prompt version', description: '**Admin only.**' })
  @ApiOkResponse({ type: PromptVersionResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Version not found' })
  version(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<PromptVersionResponseDto> {
    return this.prompts.findVersion(id, versionId);
  }

  @Post(':id/default-version')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiPromptsManage))
  @ApiOperation({ summary: 'Set the default version', description: '**Admin only.**' })
  @ApiOkResponse({ type: PromptTemplateResponseDto })
  setDefault(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDefaultPromptVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    return this.prompts.setDefaultVersion(id, dto, actor);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiPromptsManage))
  @ApiOperation({ summary: 'Activate a template', description: '**Admin only.**' })
  @ApiOkResponse({ type: PromptTemplateResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    return this.prompts.activate(id, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiPromptsManage))
  @ApiOperation({
    summary: 'Deactivate a template',
    description: 'Inactive templates are left out of new requests. **Admin only.**',
  })
  @ApiOkResponse({ type: PromptTemplateResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    return this.prompts.deactivate(id, actor);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiPromptsManage))
  @ApiOperation({
    summary: 'Archive a template',
    description: 'Versions are kept. **Admin only.**',
  })
  @ApiOkResponse({ type: PromptTemplateResponseDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    return this.prompts.archive(id, actor);
  }
}

@ApiTags('AI admin: safety policies')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/ai/safety-policies')
export class AdminAiSafetyPoliciesController {
  constructor(private readonly policies: AiSafetyPoliciesService) {}

  @Get()
  @Authorize(admin(Permission.AiSafetyRead))
  @ApiOperation({ summary: 'List safety policies', description: '**Admin only.**' })
  @ApiOkResponse({ type: SafetyPolicyListResponseDto })
  list(@Query() query: ListSafetyPoliciesQueryDto): Promise<Paginated<SafetyPolicyResponseDto>> {
    return this.policies.list(query);
  }

  @Post()
  @Authorize(admin(Permission.AiSafetyManage))
  @ApiOperation({
    summary: 'Create a safety policy',
    description:
      'Active policies are added to prompts and checked by the rule-based response validator. Policies alone do not guarantee safe AI output. **Admin only.**',
  })
  @ApiCreatedResponse({ type: SafetyPolicyResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Code already used' })
  create(
    @Body() dto: CreateSafetyPolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SafetyPolicyResponseDto> {
    return this.policies.create(dto, actor);
  }

  @Get(':id')
  @Authorize(admin(Permission.AiSafetyRead))
  @ApiOperation({ summary: 'Get a safety policy', description: '**Admin only.**' })
  @ApiOkResponse({ type: SafetyPolicyResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Policy not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SafetyPolicyResponseDto> {
    return this.policies.findOne(id);
  }

  @Patch(':id')
  @Authorize(admin(Permission.AiSafetyManage))
  @ApiOperation({
    summary: 'Update a safety policy',
    description:
      'Changing instructions, restrictions, keywords or escalation adds a new current version. **Admin only.**',
  })
  @ApiOkResponse({ type: SafetyPolicyResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSafetyPolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SafetyPolicyResponseDto> {
    return this.policies.update(id, dto, actor);
  }

  @Get(':id/versions')
  @Authorize(admin(Permission.AiSafetyRead))
  @ApiOperation({ summary: 'List policy versions, newest first', description: '**Admin only.**' })
  @ApiOkResponse({ type: SafetyPolicyVersionResponseDto, isArray: true })
  versions(@Param('id', ParseUUIDPipe) id: string): Promise<SafetyPolicyVersionResponseDto[]> {
    return this.policies.listVersions(id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiSafetyManage))
  @ApiOperation({ summary: 'Activate a policy', description: '**Admin only.**' })
  @ApiOkResponse({ type: SafetyPolicyResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SafetyPolicyResponseDto> {
    return this.policies.activate(id, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiSafetyManage))
  @ApiOperation({ summary: 'Deactivate a policy', description: '**Admin only.**' })
  @ApiOkResponse({ type: SafetyPolicyResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SafetyPolicyResponseDto> {
    return this.policies.deactivate(id, actor);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.AiSafetyManage))
  @ApiOperation({ summary: 'Archive a policy', description: '**Admin only.**' })
  @ApiOkResponse({ type: SafetyPolicyResponseDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SafetyPolicyResponseDto> {
    return this.policies.archive(id, actor);
  }
}

@ApiTags('AI admin: usage')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/ai/usage')
export class AdminAiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get()
  @Authorize(admin(Permission.AiUsageRead))
  @ApiOperation({
    summary: 'List usage records',
    description:
      'Token counts and costs are null unless a provider reported them; they are never estimated. **Admin only.**',
  })
  @ApiOkResponse({ type: UsageListResponseDto })
  list(@Query() query: UsageFilterQueryDto): Promise<Paginated<UsageRecordResponseDto>> {
    return this.usage.list(query);
  }

  @Get('summary')
  @Authorize(admin(Permission.AiUsageRead))
  @ApiOperation({
    summary: 'Usage totals',
    description: 'Sums of reported figures; null when nothing was reported. **Admin only.**',
  })
  @ApiOkResponse({ type: UsageSummaryResponseDto })
  summary(@Query() query: UsageFilterQueryDto): Promise<UsageSummaryResponseDto> {
    return this.usage.summary(query);
  }
}

@ApiTags('AI admin: oversight')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/ai')
export class AdminAiOversightController {
  constructor(
    private readonly requests: AiRequestsService,
    private readonly conversations: AiConversationsService,
  ) {}

  @Get('requests')
  @Authorize(admin(Permission.AiRequestsRead))
  @ApiOperation({ summary: 'List AI requests', description: '**Admin only.**' })
  @ApiOkResponse({ type: AdminAiRequestListResponseDto })
  listRequests(
    @Query() query: AdminListRequestsQueryDto,
  ): Promise<Paginated<AdminAiRequestResponseDto>> {
    return this.requests.adminList(query);
  }

  @Get('requests/:id')
  @Authorize(admin(Permission.AiRequestsRead))
  @ApiOperation({
    summary: 'Get any AI request',
    description: "Viewing another user's request is audited. **Admin only.**",
  })
  @ApiOkResponse({ type: AdminAiRequestResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Request not found' })
  findRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AdminAiRequestResponseDto> {
    return this.requests.adminFindOne(id, actor);
  }

  @Get('conversations')
  @Authorize(admin(Permission.AiConversationsRead))
  @ApiOperation({ summary: 'List all conversations', description: '**Admin only.**' })
  @ApiOkResponse({ type: ConversationListResponseDto })
  listConversations(
    @Query() query: AdminListConversationsQueryDto,
  ): Promise<Paginated<ConversationResponseDto>> {
    return this.conversations.adminList(query);
  }

  @Get('conversations/:id')
  @Authorize(admin(Permission.AiConversationsRead))
  @ApiOperation({
    summary: 'Get any conversation with recent messages',
    description: "Viewing another user's conversation is audited. **Admin only.**",
  })
  @ApiOkResponse({ type: ConversationDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Conversation not found' })
  findConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConversationDetailResponseDto> {
    return this.conversations.adminFindOne(id, actor);
  }
}
