import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { Public } from '../../auth/decorators/auth.decorators';
import { IvrCallbackDto } from '../dto/ivr.dto';
import { IvrGatewayService } from '../ivr-gateway.service';

@ApiTags('IVR callback')
@Controller('ivr')
export class IvrCallbackController {
  constructor(private readonly gateway: IvrGatewayService) {}

  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'IVR provider callback',
    description:
      'Public webhook for provider-specific payloads. The registered adapter validates and normalizes the body; a configured callback signature is mandatory. No telecom request is made.',
  })
  @ApiBody({
    type: IvrCallbackDto,
    description: 'Example normalized callback payload; actual fields are adapter-specific.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  callback(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<unknown> {
    return this.gateway.handleCallback(providerIdFrom(body), headers, body);
  }
}

function providerIdFrom(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const providerId = (body as { providerId?: unknown }).providerId;
  return typeof providerId === 'string' ? providerId : undefined;
}
