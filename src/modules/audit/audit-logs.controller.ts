import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  paginated,
  paginationArgs,
  PaginationMetaDto,
  PaginationQueryDto,
  type Paginated,
} from '../../common/dto/pagination.dto';
import { Trim } from '../../common/validation/validators';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { Authorize } from '../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../roles/rbac.constants';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'course.publish', description: 'Exact action name' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ example: 'Course' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ type: Date, description: 'Inclusive start (ISO timestamp)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: Date, description: 'Exclusive end (ISO timestamp)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

class AuditActorDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() fullName: string;
}

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() action: string;
  @ApiProperty() entityType: string;
  @ApiPropertyOptional({ type: String, nullable: true }) entityId: string | null;
  @ApiPropertyOptional({ type: AuditActorDto, nullable: true }) actor: AuditActorDto | null;
  @ApiProperty() createdAt: Date;
}

export class AuditLogListResponseDto {
  @ApiProperty({ type: AuditLogResponseDto, isArray: true }) data: AuditLogResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

/**
 * Read-only view of the administrative audit trail. `details` is deliberately not returned:
 * entries may hold identifiers that only operators with database access should see.
 */
@ApiTags('Administrator Audit')
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.ReportsRead] })
  @ApiOperation({
    summary: 'List audit log entries',
    description: 'Newest first, with the acting user. **Admin only.**',
  })
  @ApiOkResponse({ type: AuditLogListResponseDto })
  async list(@Query() query: ListAuditLogsQueryDto): Promise<Paginated<AuditLogResponseDto>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actor: { select: { id: true, fullName: true } },
        },
        ...paginationArgs(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(rows, total, query);
  }
}
