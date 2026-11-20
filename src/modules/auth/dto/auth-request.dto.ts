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
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { FarmerLocationDto, LocationDto } from '../../../common/dto/location.dto';
import {
  IsNormalizedEmail,
  IsRwandanPhone,
  IsStrongPassword,
  PASSWORD_MAX_LENGTH,
  Trim,
} from '../../../common/validation/validators';
import { FarmerCategory, Language } from '../../../generated/prisma/client';
import { RoleCode } from '../../roles/rbac.constants';

export const SELF_REGISTRATION_ROLES = [RoleCode.SmartphoneFarmer, RoleCode.Facilitator] as const;
export type SelfRegistrationRole = (typeof SELF_REGISTRATION_ROLES)[number];

export class FacilitatorDetailsDto {
  @ApiProperty({ example: 'Agronomist' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  professionalTitle: string;

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

  @ApiPropertyOptional({ example: 'jeanne@example.rw', description: 'Required for facilitators' })
  @ValidateIf(
    (dto: RegisterDto) => dto.accountType === RoleCode.Facilitator || dto.email !== undefined,
  )
  @IsNormalizedEmail()
  email?: string;

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
    type: FarmerLocationDto,
    description:
      'Farmers must provide at least province, district and sector; facilitators province and district',
  })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type((options) =>
    (options?.object as RegisterDto | undefined)?.accountType === RoleCode.Facilitator
      ? LocationDto
      : FarmerLocationDto,
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
  @ApiProperty({ example: 'jeanne@example.rw' })
  @IsNormalizedEmail()
  email: string;

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
  @ApiProperty({ example: '0788123456', description: 'Phone number or email address' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier: string;
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
