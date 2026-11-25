import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { FarmerAddressDto, LocationResponseDto } from '../../../common/dto/location.dto';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  IsNormalizedEmail,
  IsRwandanPhone,
  IsStrongPassword,
  Trim,
} from '../../../common/validation/validators';
import {
  FarmerCategory,
  FarmerType,
  Language,
  Province,
  UserStatus,
} from '../../../generated/prisma/client';

/** Fields shared by direct farmer registration and farmer account requests. */
export class FarmerRegistrationFieldsDto {
  @ApiProperty({ example: 'Habimana Jean Bosco', maxLength: 150 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @ApiProperty({ example: '0788123456', description: 'Rwandan mobile number; the farmer\'s primary identifier' })
  @IsRwandanPhone()
  phoneNumber: string;

  @ApiProperty({ example: 'habimana@example.rw', description: 'Mandatory personal email for every farmer' })
  @IsNormalizedEmail()
  email: string;

  @ApiProperty({ enum: FarmerType, example: FarmerType.BASIC_PHONE })
  @IsEnum(FarmerType)
  farmerType: FarmerType;

  @ApiPropertyOptional({ enum: FarmerCategory, default: FarmerCategory.SMALLHOLDER })
  @IsOptional()
  @IsEnum(FarmerCategory)
  farmerCategory?: FarmerCategory;

  @ApiPropertyOptional({ enum: Language, default: Language.rw, description: 'Kinyarwanda by default' })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;

  @ApiProperty({ type: FarmerAddressDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => FarmerAddressDto)
  location: FarmerAddressDto;
}

export class CreateFarmerDto extends FarmerRegistrationFieldsDto {
  @ApiPropertyOptional({
    example: 'Umuhinzi2026',
    description: 'Optional. Without it the farmer sets a password through the reset flow.',
  })
  @IsOptional()
  @IsStrongPassword()
  password?: string;
}

export class UpdateFarmerDto {
  @ApiPropertyOptional({ example: 'Habimana Jean Bosco' })
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

  @ApiPropertyOptional({ example: 'habimana@example.rw', nullable: true, description: 'null removes the email' })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNormalizedEmail()
  email?: string | null;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;

  @ApiPropertyOptional({ enum: FarmerCategory })
  @IsOptional()
  @IsEnum(FarmerCategory)
  farmerCategory?: FarmerCategory;

  @ApiPropertyOptional({ type: FarmerAddressDto, description: 'Replaces the whole location' })
  @IsOptional()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => FarmerAddressDto)
  location?: FarmerAddressDto;
}

export class ListFarmersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, phone number or email', example: 'habimana' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: FarmerType })
  @IsOptional()
  @IsEnum(FarmerType)
  farmerType?: FarmerType;

  @ApiPropertyOptional({ enum: FarmerCategory })
  @IsOptional()
  @IsEnum(FarmerCategory)
  farmerCategory?: FarmerCategory;

  @ApiPropertyOptional({ enum: Province })
  @IsOptional()
  @IsEnum(Province)
  province?: Province;

  @ApiPropertyOptional({ example: 'Musanze' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(50)
  district?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc', description: 'By registration date' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn(['asc', 'desc'])
  sort: 'asc' | 'desc' = 'desc';
}

export class FarmerResponseDto {
  @ApiProperty({ format: 'uuid', description: 'User id; used in /farmers/:id' })
  userId: string;

  @ApiProperty({ format: 'uuid' })
  profileId: string;

  @ApiProperty({ example: 'Habimana Jean Bosco' })
  fullName: string;

  @ApiProperty({ example: '+250788123456' })
  phoneNumber: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: null })
  email: string | null;

  @ApiProperty({ enum: Language, example: Language.rw })
  preferredLanguage: Language;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({ enum: FarmerType, example: FarmerType.BASIC_PHONE })
  farmerType: FarmerType;

  @ApiProperty({ enum: FarmerCategory, example: FarmerCategory.SMALLHOLDER })
  farmerCategory: FarmerCategory;

  @ApiProperty()
  registeredAt: Date;

  @ApiPropertyOptional({ type: LocationResponseDto, nullable: true })
  location: LocationResponseDto | null;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({
    description:
      'Only on create: true when the SMTP server accepted the verification email for this farmer.',
  })
  emailSent?: boolean;
}

export class FarmerListResponseDto {
  @ApiProperty({ type: FarmerResponseDto, isArray: true })
  data: FarmerResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
