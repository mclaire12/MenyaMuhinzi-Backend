import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
import {
  CreateFacilitatorDto,
  FacilitatorListResponseDto,
  FacilitatorResponseDto,
  ListFacilitatorsQueryDto,
  UpdateFacilitatorDto,
} from './dto/facilitator.dto';
import { FacilitatorsService } from './facilitators.service';

@ApiTags('Facilitators')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('facilitators')
export class FacilitatorsController {
  constructor(private readonly facilitators: FacilitatorsService) {}

  @Get()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.FacilitatorsRead] })
  @ApiOperation({ summary: 'List facilitators', description: '**Admin only.**' })
  @ApiOkResponse({ type: FacilitatorListResponseDto })
  list(@Query() query: ListFacilitatorsQueryDto): Promise<Paginated<FacilitatorResponseDto>> {
    return this.facilitators.list(query);
  }

  @Get(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.FacilitatorsRead] })
  @ApiOperation({ summary: 'Get a facilitator by user id', description: '**Admin only.**' })
  @ApiOkResponse({ type: FacilitatorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Facilitator not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<FacilitatorResponseDto> {
    return this.facilitators.findOne(id);
  }

  @Post()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.FacilitatorsCreate] })
  @ApiOperation({
    summary: 'Register an active facilitator directly',
    description: 'Self-registered facilitators go through account approval instead. **Admin only.**',
  })
  @ApiCreatedResponse({ type: FacilitatorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Phone number or email already registered' })
  create(
    @Body() dto: CreateFacilitatorDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FacilitatorResponseDto> {
    return this.facilitators.create(dto, actor);
  }

  @Patch(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.FacilitatorsUpdate] })
  @ApiOperation({ summary: 'Update a facilitator profile', description: '**Admin only.**' })
  @ApiOkResponse({ type: FacilitatorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Facilitator not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Phone number or email already in use' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFacilitatorDto,
  ): Promise<FacilitatorResponseDto> {
    return this.facilitators.update(id, dto);
  }
}
