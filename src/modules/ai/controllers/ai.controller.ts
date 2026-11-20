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
import { PaginationQueryDto, type Paginated } from '../../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { Authorize, CurrentUser } from '../../auth/decorators/auth.decorators';
import { ALL_ROLE_CODES, Permission } from '../../roles/rbac.constants';
import { AiAssistantsService } from '../assistants/ai-assistants.service';
import { AiConversationsService } from '../conversations/ai-conversations.service';
import { AiRequestsService } from '../conversations/ai-requests.service';
import {
  AiAssistantSummaryDto,
  AiAssistantSummaryListResponseDto,
  ListAiAssistantsQueryDto,
} from '../dto/assistant.dto';
import {
  AiRequestResponseDto,
  ConversationDetailResponseDto,
  ConversationListResponseDto,
  ConversationResponseDto,
  ListConversationsQueryDto,
  MessageListResponseDto,
  MessageResponseDto,
  PostMessageDto,
  PostMessageResponseDto,
  RenameConversationDto,
  StartConversationDto,
} from '../dto/conversation.dto';

const assistantReaders = { roles: ALL_ROLE_CODES, permissions: [Permission.AiAssistantsRead] };
const conversers = { roles: ALL_ROLE_CODES, permissions: [Permission.AiConversationsManage] };

@ApiTags('AI assistants')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('ai/assistants')
export class AiAssistantsController {
  constructor(private readonly assistants: AiAssistantsService) {}

  @Get()
  @Authorize(assistantReaders)
  @ApiOperation({
    summary: 'List assistants available to me',
    description: 'Active assistants offered to one of my roles.',
  })
  @ApiOkResponse({ type: AiAssistantSummaryListResponseDto })
  list(
    @Query() query: ListAiAssistantsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<AiAssistantSummaryDto>> {
    return this.assistants.listAvailable(actor, query);
  }

  @Get(':id')
  @Authorize(assistantReaders)
  @ApiOperation({ summary: 'Get an available assistant' })
  @ApiOkResponse({ type: AiAssistantSummaryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Not found or not available to me' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiAssistantSummaryDto> {
    return this.assistants.findAvailable(id, actor);
  }
}

@ApiTags('AI conversations')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Not found or not mine' })
@Controller('ai/conversations')
export class AiConversationsController {
  constructor(private readonly conversations: AiConversationsService) {}

  @Post()
  @Authorize(conversers)
  @ApiOperation({ summary: 'Start a conversation with an assistant' })
  @ApiCreatedResponse({ type: ConversationResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Assistant is not active' })
  start(
    @Body() dto: StartConversationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConversationResponseDto> {
    return this.conversations.start(dto, actor);
  }

  @Get()
  @Authorize(conversers)
  @ApiOperation({ summary: 'List my conversations', description: 'Most recently active first.' })
  @ApiOkResponse({ type: ConversationListResponseDto })
  list(
    @Query() query: ListConversationsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<ConversationResponseDto>> {
    return this.conversations.listOwn(actor, query);
  }

  @Get(':id')
  @Authorize(conversers)
  @ApiOperation({ summary: 'Get my conversation with its recent messages' })
  @ApiOkResponse({ type: ConversationDetailResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConversationDetailResponseDto> {
    return this.conversations.findOwn(id, actor);
  }

  @Patch(':id')
  @Authorize(conversers)
  @ApiOperation({ summary: 'Rename my conversation' })
  @ApiOkResponse({ type: ConversationResponseDto })
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameConversationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConversationResponseDto> {
    return this.conversations.rename(id, dto, actor);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Authorize(conversers)
  @ApiOperation({ summary: 'Archive my conversation', description: 'Messages are kept.' })
  @ApiOkResponse({ type: ConversationResponseDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConversationResponseDto> {
    return this.conversations.archive(id, actor);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @Authorize(conversers)
  @ApiOperation({ summary: 'Close my conversation', description: 'No further messages.' })
  @ApiOkResponse({ type: ConversationResponseDto })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConversationResponseDto> {
    return this.conversations.close(id, actor);
  }

  @Get(':id/messages')
  @Authorize(conversers)
  @ApiOperation({ summary: 'Message history, oldest first' })
  @ApiOkResponse({ type: MessageListResponseDto })
  messages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<MessageResponseDto>> {
    return this.conversations.listMessages(id, actor, query);
  }

  @Post(':id/messages')
  @Authorize(conversers)
  @ApiOperation({
    summary: 'Send a message',
    description:
      'Stores the message and creates an AI request. No AI provider is configured yet, so no answer is generated: the request fails with AI_PROVIDER_NOT_CONFIGURED (or AI_MODEL_CONFIGURATION_MISSING) and `execution.providerConfigured` is false.',
  })
  @ApiCreatedResponse({ type: PostMessageResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Conversation archived or closed, or assistant inactive',
  })
  postMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PostMessageResponseDto> {
    return this.conversations.postMessage(id, dto, actor);
  }
}

@ApiTags('AI requests')
@ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Not found or not mine' })
@Controller('ai/requests')
export class AiRequestsController {
  constructor(private readonly requests: AiRequestsService) {}

  @Get(':id')
  @Authorize(conversers)
  @ApiOperation({ summary: 'Status of my AI request' })
  @ApiOkResponse({ type: AiRequestResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiRequestResponseDto> {
    return this.requests.findOwn(id, actor);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Authorize(conversers)
  @ApiOperation({ summary: 'Cancel my queued AI request' })
  @ApiOkResponse({ type: AiRequestResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Already processing or finished' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AiRequestResponseDto> {
    return this.requests.cancel(id, actor);
  }
}
