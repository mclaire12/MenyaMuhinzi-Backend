import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiProperty } from '@nestjs/swagger';
import { CurrentUserResponseDto, UserResponseDto } from '../../users/dto/user-response.dto';
import { BFF_SECRET_HEADER, WEB_SESSION_HEADER } from '../web-session.constants';

export class WebSessionCreatedResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({ example: '2026-11-24T16:00:00.000Z' })
  idleExpiresAt: Date;

  @ApiProperty({ example: '2026-11-25T04:00:00.000Z' })
  absoluteExpiresAt: Date;
}

export class WebSessionMeResponseDto extends CurrentUserResponseDto {}

export const WebSessionBffHeaders = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiHeader({
      name: BFF_SECRET_HEADER,
      description: 'Shared secret identifying the Vercel BFF. Required on every web-session route.',
      required: true,
    }),
  );

export const WebSessionIdHeaders = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiHeader({
      name: BFF_SECRET_HEADER,
      description: 'Shared secret identifying the Vercel BFF. Required on every web-session route.',
      required: true,
    }),
    ApiHeader({
      name: WEB_SESSION_HEADER,
      description: 'Opaque session id. Returned only through this header, never in JSON.',
      required: true,
    }),
  );