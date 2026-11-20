import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  IsNormalizedEmail,
  IsRwandanPhone,
  IsStrongPassword,
  Trim,
} from '../../../common/validation/validators';
import { Language, UserStatus } from '../../../generated/prisma/client';
import { ALL_ROLE_CODES, type RoleCode } from '../../roles/rbac.constants';

export class CreateUserDto {
  @ApiProperty({ example: 'Mukamana Alice', maxLength: 150 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @ApiProperty({ example: '0788123456', description: 'Rwandan mobile number; stored as +2507XXXXXXXX' })
  @IsRwandanPhone()
  phoneNumber: string;

  @ApiPropertyOptional({ example: 'alice@example.rw' })
  @IsOptional()
  @IsNormalizedEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'Umuhinzi2026',
    description: 'Optional. Without it the user sets a password through the reset flow.',
  })
  @IsOptional()
  @IsStrongPassword()
  password?: string;

  @ApiProperty({ enum: ALL_ROLE_CODES, isArray: true, example: ['FACILITATOR'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(ALL_ROLE_CODES, { each: true })
  roles: RoleCode[];

  @ApiPropertyOptional({ enum: Language, default: Language.rw })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Mukamana Alice' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({ example: '0722123456' })
  @IsOptional()
  @IsRwandanPhone()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'alice@example.rw', nullable: true, description: 'null removes the email' })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNormalizedEmail()
  email?: string | null;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;
}

export const MANAGEABLE_STATUSES = [UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.SUSPENDED] as const;
export type ManageableStatus = (typeof MANAGEABLE_STATUSES)[number];

export class UpdateUserStatusDto {
  @ApiProperty({
    enum: MANAGEABLE_STATUSES,
    example: UserStatus.SUSPENDED,
    description:
      'ACTIVE activates or reactivates; INACTIVE deactivates; SUSPENDED suspends. ' +
      'PENDING accounts must go through the account-request approval endpoints.',
  })
  @IsIn(MANAGEABLE_STATUSES)
  status: ManageableStatus;

  @ApiPropertyOptional({
    example: 'Repeated sharing of misleading pest-control advice',
    description: 'Required when suspending',
  })
  @ValidateIf((dto: UpdateUserStatusDto) => dto.status === UserStatus.SUSPENDED || dto.reason !== undefined)
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason?: string;
}

export class AssignRolesDto {
  @ApiProperty({
    enum: ALL_ROLE_CODES,
    isArray: true,
    example: ['FACILITATOR'],
    description: 'Replaces all current roles. SMARTPHONE_FARMER and BASIC_PHONE_FARMER are mutually exclusive.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(ALL_ROLE_CODES, { each: true })
  roles: RoleCode[];
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, phone number or email', example: 'uwimana' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ enum: ALL_ROLE_CODES })
  @IsOptional()
  @IsIn(ALL_ROLE_CODES)
  role?: RoleCode;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc', description: 'By creation date' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn(['asc', 'desc'])
  sort: 'asc' | 'desc' = 'desc';
}
