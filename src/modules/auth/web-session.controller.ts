import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { CurrentUserResponseDto } from '../users/dto/user-response.dto';
import { AuthRateLimit, BffProtected, Client, Public } from './decorators/auth.decorators';
import { WebSessionId } from './decorators/web-session.decorator';
import { LoginDto } from './dto/auth-request.dto';
import {
  WebSessionBffHeaders,
  WebSessionCreatedResponseDto,
  WebSessionIdHeaders,
  WebSessionMeResponseDto,
} from './dto/web-session.dto';
import { BffGuard } from './guards/bff.guard';
import type { ClientContext } from './auth.types';
import {
  GoogleOAuthCompleteDto,
  GoogleOAuthStartDto,
  GoogleOAuthStartResponseDto,
  GoogleOAuthStatusResponseDto,
} from './dto/google-oauth.dto';
import { GoogleOauthService } from './oauth/google-oauth.service';
import { GoogleWebSessionAuthService } from './oauth/google-web-session-auth.service';
import { WebSessionAuthService } from './services/web-session-auth.service';
import {
  ACCESS_EXPIRES_HEADER,
  ACCESS_TOKEN_HEADER,
  WEB_SESSION_HEADER,
} from './web-session.constants';

@ApiTags('Web sessions (BFF)')
@Controller('auth/web-sessions')
@Public()
@BffProtected()
@UseGuards(BffGuard)
@AuthRateLimit()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid BFF secret or session' })
@ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Browser request or inactive account' })
export class WebSessionController {
  constructor(
    private readonly webSessions: WebSessionAuthService,
    private readonly googleWeb: GoogleWebSessionAuthService,
    private readonly google: GoogleOauthService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a browser web session',
    description:
      'Authenticates with email and password, creates a refresh-token family and WebSession row, ' +
      'and returns the opaque session id only through `X-Menya-Web-Session`. **BFF only.**',
  })
  @ApiCreatedResponse({ type: WebSessionCreatedResponseDto })
  @WebSessionBffHeaders()
  async create(
    @Res({ passthrough: true }) res: Response,
    @Client() client: ClientContext,
    @Body() dto: LoginDto,
  ): Promise<WebSessionCreatedResponseDto> {
    const created = await this.webSessions.create(dto, client);
    res.setHeader(WEB_SESSION_HEADER, created.sessionId);
    return created.body;
  }

  @Get('me')
  @ApiOperation({
    summary: 'Current user for an active web session',
    description: '**BFF only.** Requires `X-Menya-Web-Session`.',
  })
  @ApiOkResponse({ type: WebSessionMeResponseDto })
  @WebSessionIdHeaders()
  me(@WebSessionId() sessionId: string): Promise<CurrentUserResponseDto> {
    return this.webSessions.currentUser(sessionId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate refresh credentials for a web session',
    description:
      'Returns a replacement opaque session id in `X-Menya-Web-Session` and a short-lived access token in ' +
      '`X-Menya-Access-Token` for downstream BFF API calls. **BFF only.**',
  })
  @ApiOkResponse({ description: 'Credentials rotated; response body is empty' })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, type: ErrorResponseDto })
  @WebSessionIdHeaders()
  async refresh(
    @Res({ passthrough: true }) res: Response,
    @WebSessionId() sessionId: string,
    @Client() client: ClientContext,
  ): Promise<void> {
    const outcome = await this.webSessions.refresh(sessionId, client);
    res.setHeader(WEB_SESSION_HEADER, outcome.sessionId);
    res.setHeader(ACCESS_TOKEN_HEADER, outcome.accessToken);
    res.setHeader(ACCESS_EXPIRES_HEADER, String(outcome.expiresIn));
  }

  @Delete('current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'End the current web session',
    description: 'Revokes the session and its refresh-token family. **BFF only.**',
  })
  @ApiNoContentResponse()
  @WebSessionIdHeaders()
  async logout(@WebSessionId() sessionId: string): Promise<void> {
    await this.webSessions.logout(sessionId);
  }

  @Get('google/status')
  @ApiOperation({ summary: 'Whether Google sign-in is configured', description: '**BFF only.**' })
  @ApiOkResponse({ type: GoogleOAuthStatusResponseDto })
  googleStatus(): GoogleOAuthStatusResponseDto {
    return this.google.status();
  }

  @Post('google/start')
  @ApiOperation({
    summary: 'Begin Google OpenID Connect sign-in',
    description: 'Returns a Google authorization URL. State, nonce and PKCE are stored server-side. **BFF only.**',
  })
  @ApiCreatedResponse({ type: GoogleOAuthStartResponseDto })
  startGoogle(@Body() dto: GoogleOAuthStartDto): Promise<GoogleOAuthStartResponseDto> {
    return this.googleWeb.start(dto);
  }

  @Post('google/complete')
  @ApiOperation({
    summary: 'Complete Google sign-in and create a web session',
    description: 'Verifies the authorization code, links or creates accounts safely, and returns `X-Menya-Web-Session`. **BFF only.**',
  })
  @ApiCreatedResponse({ type: WebSessionCreatedResponseDto })
  @WebSessionBffHeaders()
  async completeGoogle(
    @Res({ passthrough: true }) res: Response,
    @Client() client: ClientContext,
    @Body() dto: GoogleOAuthCompleteDto,
  ): Promise<WebSessionCreatedResponseDto> {
    const created = await this.googleWeb.complete(dto, client);
    res.setHeader(WEB_SESSION_HEADER, created.sessionId);
    return created.body;
  }
}