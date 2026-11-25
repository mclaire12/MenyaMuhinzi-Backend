import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { FarmerAddressDto, LocationDto } from '../../../common/dto/location.dto';
import {
  IsNormalizedEmail,
  IsRwandanPhone,
  IsStrongPassword,
  PASSWORD_MAX_LENGTH,
  Trim,
} from '../../../common/validation/validators';
import { FarmerCategory, Language } from '../../../generated/prisma/client';
import { FACILITATOR_TITLES, type FacilitatorTitle } from '../../facilitators/facilitator-titles';
import { RoleCode } from '../../roles/rbac.constants';

export const SELF_REGISTRATION_ROLES = [RoleCode.SmartphoneFarmer, RoleCode.Facilitator] as const;
export type SelfRegistrationRole = (typeof SELF_REGISTRATION_ROLES)[number];

export class FacilitatorDetailsDto {
  @ApiProperty({ enum: FACILITATOR_TITLES, example: 'Agronomist' })
  @IsIn(FACILITATOR_TITLES, {
    message: `professionalTitle must be one of: ${FACILITATOR_TITLES.join(', ')}`,
  })
  professionalTitle: FacilitatorTitle;

  @ApiProperty({ example: 'Rwanda Agriculture Board' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  organization: string;

  @ApiPropertyOptional({ example: 'office@rab.gov.rw' })
  @IsOptional()
  @IsNormalizedEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '0788654321' })
  @IsOptional()
  @IsRwandanPhone()
  contactPhone?: string;
}

export class RegisterDto {
  @ApiProperty({
    enum: SELF_REGISTRATION_ROLES,
    example: RoleCode.SmartphoneFarmer,
    description:
      'Basic-phone farmers are registered by facilitators or administrators; administrators cannot self-register.',
  })
  @IsIn(SELF_REGISTRATION_ROLES)
  accountType: SelfRegistrationRole;

  @ApiProperty({ example: 'Uwimana Jeanne', maxLength: 150 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @ApiProperty({ example: '0788123456', description: 'Rwandan mobile number' })
  @IsRwandanPhone()
  phoneNumber: string;

  @ApiProperty({
    example: 'jeanne@example.rw',
    description: 'Required personal email for every registrant',
  })
  @IsNormalizedEmail()
  email: string;

  @ApiProperty({
    example: 'Umuhinzi2026',
    description: 'At least 8 characters with a letter and a digit',
  })
  @IsStrongPassword()
  password: string;

  @ApiPropertyOptional({ enum: Language, default: Language.rw })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;

  @ApiProperty({
    type: FarmerAddressDto,
    description:
      'Farmers must provide province, district, sector, cell and village; facilitators province and district (sector, cell and village optional)',
  })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type((options) =>
    (options?.object as RegisterDto | undefined)?.accountType === RoleCode.Facilitator
      ? LocationDto
      : FarmerAddressDto,
  )
  location: LocationDto;

  @ApiPropertyOptional({ enum: FarmerCategory, default: FarmerCategory.SMALLHOLDER })
  @ValidateIf(
    (dto: RegisterDto) =>
      dto.accountType === RoleCode.SmartphoneFarmer && dto.farmerCategory !== undefined,
  )
  @IsEnum(FarmerCategory)
  farmerCategory?: FarmerCategory;

  @ApiPropertyOptional({ type: FacilitatorDetailsDto, description: 'Required for facilitators' })
  @ValidateIf((dto: RegisterDto) => dto.accountType === RoleCode.Facilitator)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => FacilitatorDetailsDto)
  facilitator?: FacilitatorDetailsDto;
}

export class LoginDto {
  @ApiPropertyOptional({
    example: 'jeanne@example.rw',
    description:
      'Personal email or Rwandan phone number (07XXXXXXXX, 2507XXXXXXXX or +2507XXXXXXXX)',
  })
  @ValidateIf((dto: LoginDto) => dto.identifier !== undefined || dto.email === undefined)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier?: string;

  @ApiPropertyOptional({ description: 'Deprecated compatibility field; use identifier' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(254)
  email?: string;

  @ApiProperty({ example: 'Umuhinzi2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty({ example: 'n3Vb2-...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Session to end. Required unless allDevices is true.' })
  @ValidateIf((dto: LogoutDto) => dto.allDevices !== true)
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken?: string;

  @ApiPropertyOptional({ default: false, description: 'End every session of the current user' })
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'Umuhinzi2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({
    example: 'Ibihingwa2027',
    description: 'At least 8 characters with a letter and a digit',
  })
  @IsStrongPassword()
  newPassword: string;
}

export class ForgotPasswordDto {
  @ApiPropertyOptional({ example: '0788123456', description: 'Phone number or email address' })
  @ValidateIf((dto: ForgotPasswordDto) => dto.identifier !== undefined || dto.email === undefined)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier?: string;

  @ApiPropertyOptional({ description: 'Deprecated compatibility field' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(254)
  email?: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token delivered by SMS or email' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @ApiProperty({ example: 'Ibihingwa2027' })
  @IsStrongPassword()
  newPassword: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Single-use token from the verification email link' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @ApiProperty({ example: '482913', description: '6-digit code from the same verification email' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from the email' })
  code: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'jeanne@example.rw', description: 'Personal email or phone number' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier: string;
}
