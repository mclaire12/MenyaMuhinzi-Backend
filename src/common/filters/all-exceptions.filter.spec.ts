import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '../../generated/prisma/client';
import type { ErrorResponseDto } from '../dto/error-response.dto';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  const reply = jest.fn();
  const request = { url: '/api/v1/courses', method: 'POST', id: 'req-123' };
  let filter: AllExceptionsFilter;
  let host: ArgumentsHost;

  beforeEach(() => {
    reply.mockReset();
    const adapterHost = {
      httpAdapter: {
        getRequestUrl: (req: typeof request) => req.url,
        getRequestMethod: (req: typeof request) => req.method,
        reply,
      },
    } as unknown as HttpAdapterHost;
    filter = new AllExceptionsFilter(adapterHost);
    host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    } as unknown as ArgumentsHost;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const lastBody = (): ErrorResponseDto => reply.mock.calls[0][1] as ErrorResponseDto;
  const lastStatus = (): number => reply.mock.calls[0][2] as number;

  it('formats an HttpException into the error envelope', () => {
    filter.catch(new NotFoundException('Course not found'), host);

    expect(lastStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(lastBody()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Course not found',
      path: '/api/v1/courses',
      method: 'POST',
      timestamp: expect.any(String),
      requestId: 'req-123',
    });
  });

  it('keeps the list of validation messages', () => {
    filter.catch(new BadRequestException(['title must be a string', 'title should not be empty']), host);

    expect(lastStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(lastBody().message).toEqual(['title must be a string', 'title should not be empty']);
  });

  it('maps a Prisma unique-constraint violation to 409 Conflict', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

    filter.catch(error, host);

    expect(lastStatus()).toBe(HttpStatus.CONFLICT);
    expect(lastBody().message).toBe('Resource conflict');
  });

  it('maps a Prisma record-not-found error to 404', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: 'test',
    });

    filter.catch(error, host);

    expect(lastStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it('hides internal details of unexpected errors and logs them', () => {
    filter.catch(new Error('password=hunter2 leaked in stack'), host);

    expect(lastStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(lastBody().message).toBe('An unexpected error occurred');
    expect(JSON.stringify(lastBody())).not.toContain('hunter2');
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
