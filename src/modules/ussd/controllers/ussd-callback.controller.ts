import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { Public } from '../../auth/decorators/auth.decorators';
import { UssdCallbackDto } from '../dto/ussd.dto';
import { UssdGatewayService } from '../ussd-gateway.service';

@ApiTags('USSD callback')
@Controller('ussd')
export class UssdCallbackController {
  constructor(private readonly gateway: UssdGatewayService) {}

  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'USSD provider callback',
    description:
      'Public webhook for provider-specific payloads. The registered adapter validates and normalizes the body; a configured callback signature is mandatory. No telecom network call is made by this API.',
  })
  @ApiBody({
    type: UssdCallbackDto,
    description: 'Example normalized callback payload; actual fields are adapter-specific.',
  })
  @ApiOkResponse({ description: 'Provider-formatted USSD response body' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  callback(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<unknown> {
    return this.gateway
      .handleCallback(providerIdFrom(body), headers, body)
      .then((result) => result.formatted);
  }
}

function providerIdFrom(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const providerId = (body as { providerId?: unknown }).providerId;
  return typeof providerId === 'string' ? providerId : undefined;
}
