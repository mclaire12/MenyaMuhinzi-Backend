import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Language } from '../../../generated/prisma/client';
import { IsRwandanPhone, Trim } from '../../../common/validation/validators';
import { SELF_REGISTRATION_ROLES, type SelfRegistrationRole } from './auth-request.dto';

export class GoogleOAuthStartDto {
  @ApiProperty({ enum: ['login', 'register'] })
  @IsIn(['login', 'register'])
  mode: 'login' | 'register';

  @ApiProperty({
    example: 'http://localhost:3000/auth/google/callback',
    description: 'Must match a registered Google redirect URI and the frontend callback route.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  redirectUri: string;

  @ApiPropertyOptional({ enum: SELF_REGISTRATION_ROLES })
  @IsOptional()
  @IsIn(SELF_REGISTRATION_ROLES)
  accountType?: SelfRegistrationRole;

  @ApiPropertyOptional({ example: '0788123456', description: 'Required when mode is register.' })
  @IsOptional()
  @IsRwandanPhone()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'Uwimana Jeanne' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;
}

export class GoogleOAuthCompleteDto {
  @ApiProperty()
  @Trim()
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty()
  @Trim()
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({
    example: 'http://localhost:3000/auth/google/callback?code=...&state=...',
    description: 'Full callback URL including query string exactly as returned by Google.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  callbackUrl: string;
}

export class GoogleOAuthStartResponseDto {
  @ApiProperty({ description: 'Google authorization URL to redirect the browser to.' })
  authorizationUrl: string;
}

export class GoogleOAuthStatusResponseDto {
  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Public client id when Google sign-in is configured.' })
  clientId?: string;
}