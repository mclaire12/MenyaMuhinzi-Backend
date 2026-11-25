import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { CurrentUserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import type { AuthenticatedUser, ClientContext } from './auth.types';
import {
  AuthRateLimit,
  Authorize,
  Client,
  CurrentUser,
  Public,
} from './decorators/auth.decorators';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth-request.dto';
import {
  AuthTokensResponseDto,
  ForgotPasswordResponseDto,
  RegistrationResponseDto,
} from './dto/auth-response.dto';

@ApiTags('Authentication')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @AuthRateLimit()
  @ApiOperation({
    summary: 'Self-register as a smartphone farmer or facilitator',
    description:
      'A personal email is required. Smartphone farmers receive an email verification link ' +
      'immediately and can sign in once verified (no administrator approval). Facilitator ' +
      'accounts require administrator approval first; the verification link is sent only after ' +
      'approval. A previously rejected applicant may register again with the same phone number. **Public.**',
  })
  @ApiCreatedResponse({ type: RegistrationResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Phone number or email already registered, or a request is already pending',
  })
  register(@Body() dto: RegisterDto): Promise<RegistrationResponseDto> {
    return this.auth.register(dto);
  }

  @Post('verify-email')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Verify an email with the link token and the 6-digit code from the same email',
    description:
      'Tokens expire after 24 hours and can be used once. After 5 wrong codes the link is retired and a new email must be requested. **Public.**',
  })
  @ApiNoContentResponse({ description: 'Email verified' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Wrong code, or invalid, expired or used link' })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.auth.verifyEmail(dto.token, dto.code);
  }

  @Post('resend-verification')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a new email verification link',
    description:
      'Always returns 202 so account existence is not revealed. Only active, unverified accounts ' +
      'receive a link, at most once per minute. **Public.**',
  })
  @ApiAcceptedResponse({ description: 'Generic verification response' })
  resendVerification(@Body() dto: ResendVerificationDto): Promise<{ message: string }> {
    return this.auth.resendEmailVerification(dto.identifier);
  }

  @Post('login')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with email or phone number and password',
    description:
      'Returns a short-lived access token and a single-use refresh token. After ' +
      'AUTH_MAX_FAILED_LOGINS consecutive wrong passwords the account is locked for ' +
      'AUTH_LOCKOUT_MINUTES. **Public.**',
  })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid credentials' })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Account pending, inactive, suspended or rejected',
  })
  @ApiResponse({
    status: HttpStatus.LOCKED,
    type: ErrorResponseDto,
    description: 'Account temporarily locked',
  })
  login(@Body() dto: LoginDto, @Client() client: ClientContext): Promise<AuthTokensResponseDto> {
    return this.auth.login(dto, client);
  }

  @Post('refresh')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for new tokens',
    description:
      'The submitted refresh token is revoked and replaced. Re-using an already rotated token ' +
      'revokes the whole session (token theft protection). **Public.**',
  })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Invalid, expired, revoked or reused token',
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Account is no longer active' })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Client() client: ClientContext,
  ): Promise<AuthTokensResponseDto> {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @Post('logout')
  @Authorize()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out',
    description:
      'Revokes the given session, or every session with allDevices=true. **Authenticated.**',
  })
  @ApiNoContentResponse({ description: 'Session revoked' })
  logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: LogoutDto): Promise<void> {
    return this.auth.logout(user, dto);
  }

  @Get('me')
  @Authorize()
  @ApiOperation({
    summary: 'Current user with roles and permissions',
    description: '**Authenticated.**',
  })
  @ApiOkResponse({ type: CurrentUserResponseDto })
  me(@CurrentUser() user: AuthenticatedUser): Promise<CurrentUserResponseDto> {
    return this.auth.me(user);
  }

  @Post('change-password')
  @Authorize()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Change the current user's password",
    description:
      'Ends every session, including the current one; sign in again afterwards. **Authenticated.**',
  })
  @ApiNoContentResponse({ description: 'Password changed' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.auth.changePassword(user, dto);
  }

  @Post('forgot-password')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a password reset',
    description:
      'Always returns 202 so account existence is not revealed. For active accounts a single-use ' +
      'token is created and a delivery job (SMS, or email when an email was given) is queued. ' +
      '**Public.**',
  })
  @ApiAcceptedResponse({ type: ForgotPasswordResponseDto })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Client() client: ClientContext,
  ): Promise<ForgotPasswordResponseDto> {
    return this.auth.forgotPassword(dto, client);
  }

  @Post('reset-password')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password with a reset token',
    description:
      'The token is single use and expires after AUTH_PASSWORD_RESET_TTL_MINUTES. Ends every session. **Public.**',
  })
  @ApiNoContentResponse({ description: 'Password reset' })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto);
  }
}
