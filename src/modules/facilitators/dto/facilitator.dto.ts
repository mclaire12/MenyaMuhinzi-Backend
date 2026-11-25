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
import { LocationDto, LocationResponseDto } from '../../../common/dto/location.dto';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  IsNormalizedEmail,
  IsRwandanPhone,
  IsStrongPassword,
  Trim,
} from '../../../common/validation/validators';
import { Language, Province, UserStatus } from '../../../generated/prisma/client';
import { FacilitatorDetailsDto } from '../../auth/dto/auth-request.dto';

export class CreateFacilitatorDto extends FacilitatorDetailsDto {
  @ApiProperty({ example: 'Niyonsaba Claudine', maxLength: 150 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @ApiProperty({ example: '0788654321', description: 'Rwandan mobile number; used to sign in' })
  @IsRwandanPhone()
  phoneNumber: string;

  @ApiProperty({ example: 'claudine@rab.gov.rw' })
  @IsNormalizedEmail()
  email: string;

  @ApiPropertyOptional({
    example: 'Ubuhinzi2026',
    description: 'Optional. Without it the facilitator sets a password through the reset flow.',
  })
  @IsOptional()
  @IsStrongPassword()
  password?: string;

  @ApiPropertyOptional({ enum: Language, default: Language.rw })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;

  @ApiProperty({ type: LocationDto, description: 'Area of operation (province and district required)' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => LocationDto)
  location: LocationDto;
}

export class UpdateFacilitatorDto {
  @ApiPropertyOptional({ example: 'Niyonsaba Claudine' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({ example: '0722654321' })
  @IsOptional()
  @IsRwandanPhone()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'claudine@rab.gov.rw' })
  @IsOptional()
  @IsNormalizedEmail()
  email?: string;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;

  @ApiPropertyOptional({ example: 'Senior Agronomist' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  professionalTitle?: string;

  @ApiPropertyOptional({ example: 'Rwanda Agriculture Board' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  organization?: string;

  @ApiPropertyOptional({ example: 'office@rab.gov.rw', nullable: true, description: 'null removes it' })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNormalizedEmail()
  contactEmail?: string | null;

  @ApiPropertyOptional({ example: '0788000111', nullable: true, description: 'null removes it' })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsRwandanPhone()
  contactPhone?: string | null;

  @ApiPropertyOptional({ type: LocationDto, description: 'Replaces the whole location' })
  @IsOptional()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;
}

export class ListFacilitatorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, phone number or email', example: 'claudine' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: 'Rwanda Agriculture Board' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  organization?: string;

  @ApiPropertyOptional({ enum: Province })
  @IsOptional()
  @IsEnum(Province)
  province?: Province;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc', description: 'By creation date' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn(['asc', 'desc'])
  sort: 'asc' | 'desc' = 'desc';
}

export class FacilitatorResponseDto {
  @ApiProperty({ format: 'uuid', description: 'User id; used in /facilitators/:id' })
  userId: string;

  @ApiProperty({ format: 'uuid' })
  profileId: string;

  @ApiProperty({ example: 'Niyonsaba Claudine' })
  fullName: string;

  @ApiProperty({ example: '+250788654321' })
  phoneNumber: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'claudine@rab.gov.rw' })
  email: string | null;

  @ApiProperty({ enum: Language })
  preferredLanguage: Language;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({ example: 'Agronomist' })
  professionalTitle: string;

  @ApiProperty({ example: 'Rwanda Agriculture Board' })
  organization: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  contactEmail: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  contactPhone: string | null;

  @ApiPropertyOptional({ type: LocationResponseDto, nullable: true })
  location: LocationResponseDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'Only on create: true when the SMTP server accepted the verification email.',
  })
  emailSent?: boolean;
}

export class FacilitatorListResponseDto {
  @ApiProperty({ type: FacilitatorResponseDto, isArray: true })
  data: FacilitatorResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
