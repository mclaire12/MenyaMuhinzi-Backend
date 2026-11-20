import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import type { Paginated } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Authorize, CurrentUser } from '../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../roles/rbac.constants';
import { AccountRequestsService } from './account-requests.service';
import {
  AccountRequestListResponseDto,
  AccountRequestResponseDto,
  ApproveAccountRequestDto,
  CreateAccountRequestDto,
  ListAccountRequestsQueryDto,
  RejectAccountRequestDto,
} from './dto/account-request.dto';

@ApiTags('Account Requests')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('accounts/requests')
export class AccountRequestsController {
  constructor(private readonly requests: AccountRequestsService) {}

  @Post()
  @Authorize({
    roles: [RoleCode.Admin, RoleCode.Facilitator],
    permissions: [Permission.AccountRequestsCreate],
  })
  @ApiOperation({
    summary: 'Submit a farmer for account approval',
    description:
      'Registers a smartphone or basic-phone farmer on their behalf as a PENDING account ' +
      '(no password; email optional). Once approved, smartphone farmers set a password through ' +
      'forgot-password. Self-registration uses POST /auth/register. **Admin or facilitator.**',
  })
  @ApiCreatedResponse({ type: AccountRequestResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Phone number or email already registered, or a request is already pending',
  })
  create(
    @Body() dto: CreateAccountRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AccountRequestResponseDto> {
    return this.requests.create(dto, actor);
  }

  @Get()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.AccountRequestsRead] })
  @ApiOperation({
    summary: 'List account requests',
    description: 'Defaults to PENDING requests, oldest first. **Admin only.**',
  })
  @ApiOkResponse({ type: AccountRequestListResponseDto })
  list(@Query() query: ListAccountRequestsQueryDto): Promise<Paginated<AccountRequestResponseDto>> {
    return this.requests.list(query);
  }

  @Get(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.AccountRequestsRead] })
  @ApiOperation({ summary: 'Get an account request', description: '**Admin only.**' })
  @ApiOkResponse({ type: AccountRequestResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Account request not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AccountRequestResponseDto> {
    return this.requests.findOne(id);
  }

  @Post(':id/approve')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.AccountRequestsDecide] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a pending account request',
    description:
      'Activates the account and records the deciding administrator and time. **Admin only.**',
  })
  @ApiOkResponse({ type: AccountRequestResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Account request not found' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Request was already approved or rejected',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveAccountRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AccountRequestResponseDto> {
    return this.requests.approve(id, dto, actor);
  }

  @Post(':id/reject')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.AccountRequestsDecide] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a pending account request',
    description:
      'Marks the account REJECTED with the reason. The applicant may submit a new request later. **Admin only.**',
  })
  @ApiOkResponse({ type: AccountRequestResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Account request not found' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Request was already approved or rejected',
  })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAccountRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AccountRequestResponseDto> {
    return this.requests.reject(id, dto, actor);
  }
}
