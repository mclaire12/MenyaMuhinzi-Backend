import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class AuthTokensResponseDto {
  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ example: 'q8Jx...', description: 'Opaque token; single use, rotated on refresh' })
  refreshToken: string;

  @ApiProperty()
  refreshTokenExpiresAt: Date;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}

export class RegistrationResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({ example: true })
  requiresApproval: boolean;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  accountRequestId: string | null;

  @ApiProperty({ example: 'Registration received. An administrator will review your account.' })
  message: string;
}

export class ForgotPasswordResponseDto {
  @ApiProperty({
    example: 'If an active account matches, password reset instructions have been sent.',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'Only present when AUTH_EXPOSE_RESET_TOKEN=true outside production',
  })
  resetToken?: string;

  @ApiPropertyOptional()
  expiresAt?: Date;
}
