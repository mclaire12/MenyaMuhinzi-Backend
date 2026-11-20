import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
import { Authorize } from '../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../roles/rbac.constants';
import { CropsService } from './crops.service';
import { CreateCropDto, CropResponseDto, ListCropsQueryDto, UpdateCropDto } from './dto/crop.dto';

@ApiTags('Crops')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('crops')
export class CropsController {
  constructor(private readonly crops: CropsService) {}

  @Get()
  @Authorize({ roles: [RoleCode.Admin, RoleCode.Facilitator], permissions: [Permission.CropsRead] })
  @ApiOperation({ summary: 'List crops', description: 'Defaults to every status. **Admin or facilitator.**' })
  @ApiOkResponse({ type: CropResponseDto, isArray: true })
  list(@Query() query: ListCropsQueryDto): Promise<CropResponseDto[]> {
    return this.crops.list(query.status);
  }

  @Post()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CropsManage] })
  @ApiOperation({ summary: 'Create a crop', description: '**Admin only.**' })
  @ApiCreatedResponse({ type: CropResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Code or name already used' })
  create(@Body() dto: CreateCropDto): Promise<CropResponseDto> {
    return this.crops.create(dto);
  }

  @Patch(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CropsManage] })
  @ApiOperation({ summary: 'Update a crop', description: 'The code is immutable. **Admin only.**' })
  @ApiOkResponse({ type: CropResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Crop not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Name already used' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCropDto): Promise<CropResponseDto> {
    return this.crops.update(id, dto);
  }

  @Delete(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CropsManage] })
  @ApiOperation({
    summary: 'Deactivate a crop',
    description: 'The record is kept so existing courses and groups stay valid. **Admin only.**',
  })
  @ApiOkResponse({ type: CropResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Crop not found' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<CropResponseDto> {
    return this.crops.deactivate(id);
  }
}
