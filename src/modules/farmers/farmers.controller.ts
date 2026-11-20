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
  CreateFarmerDto,
  FarmerListResponseDto,
  FarmerResponseDto,
  ListFarmersQueryDto,
  UpdateFarmerDto,
} from './dto/farmer.dto';
import { FarmersService } from './farmers.service';

@ApiTags('Farmers')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('farmers')
export class FarmersController {
  constructor(private readonly farmers: FarmersService) {}

  @Get()
  @Authorize({ roles: [RoleCode.Admin, RoleCode.Facilitator], permissions: [Permission.FarmersRead] })
  @ApiOperation({
    summary: 'List farmers',
    description: 'Filter by type, category, province, district or status. **Admin or facilitator.**',
  })
  @ApiOkResponse({ type: FarmerListResponseDto })
  list(@Query() query: ListFarmersQueryDto): Promise<Paginated<FarmerResponseDto>> {
    return this.farmers.list(query);
  }

  @Get(':id')
  @Authorize({ roles: [RoleCode.Admin, RoleCode.Facilitator], permissions: [Permission.FarmersRead] })
  @ApiOperation({ summary: 'Get a farmer by user id', description: '**Admin or facilitator.**' })
  @ApiOkResponse({ type: FarmerResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Farmer not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<FarmerResponseDto> {
    return this.farmers.findOne(id);
  }

  @Post()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.FarmersCreate] })
  @ApiOperation({
    summary: 'Register an active farmer directly',
    description:
      'Creates the user, farmer role (from farmerType), profile and location. Email is optional, ' +
      'which suits basic-phone farmers. Facilitators submit farmers for approval through ' +
      'POST /accounts/requests instead. **Admin only.**',
  })
  @ApiCreatedResponse({ type: FarmerResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Phone number or email already registered' })
  create(@Body() dto: CreateFarmerDto, @CurrentUser() actor: AuthenticatedUser): Promise<FarmerResponseDto> {
    return this.farmers.create(dto, actor);
  }

  @Patch(':id')
  @Authorize({ roles: [RoleCode.Admin, RoleCode.Facilitator], permissions: [Permission.FarmersUpdate] })
  @ApiOperation({
    summary: 'Update a farmer profile',
    description:
      'Changing between smartphone and basic-phone is a role change: use PATCH /users/:id/roles. ' +
      '**Admin or facilitator.**',
  })
  @ApiOkResponse({ type: FarmerResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Farmer not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Phone number or email already in use' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFarmerDto): Promise<FarmerResponseDto> {
    return this.farmers.update(id, dto);
  }
}
