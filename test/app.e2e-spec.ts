import { getQueueToken } from '@nestjs/bullmq';
import { Body, Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsInt, IsString, Min } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/bootstrap/setup-app';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { ALL_QUEUES } from '../src/infrastructure/queue/queue.constants';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis.constants';
import { Public } from '../src/modules/auth/decorators/auth.decorators';

class ProbeDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

/** Test-only endpoint used to exercise the global ValidationPipe. */
@Public()
@Controller('validation-probe')
class ValidationProbeController {
  @Post()
  create(@Body() dto: ProbeDto): ProbeDto {
    return dto;
  }
}

describe('MenyaMuhinzi API (e2e)', () => {
  let app: NestExpressApplication;

  const prisma = {
    ping: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
  const redisClient = {
    status: 'ready',
    ping: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
    on: jest.fn(),
  };
  const fakeQueue = (name: string) => ({ name, on: jest.fn(), close: jest.fn() });

  beforeAll(async () => {
    let builder = Test.createTestingModule({
      imports: [AppModule],
      controllers: [ValidationProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisClient);

    for (const name of ALL_QUEUES) {
      builder = builder.overrideProvider(getQueueToken(name)).useValue(fakeQueue(name));
    }

    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.ping.mockReset().mockResolvedValue(undefined);
    redisClient.ping.mockReset().mockResolvedValue('PONG');
    redisClient.status = 'ready';
  });

  describe('GET /api/v1/health/live', () => {
    it('returns 200 with a request id and without framework fingerprinting', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

      expect(res.body).toEqual({
        status: 'ok',
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
      });
      expect(res.headers['x-request-id']).toEqual(expect.any(String));
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('echoes a caller-provided request id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .set('x-request-id', 'trace-abc')
        .expect(200);

      expect(res.headers['x-request-id']).toBe('trace-abc');
    });
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 when PostgreSQL and Redis are reachable', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.checks.database.status).toBe('up');
      expect(res.body.checks.redis.status).toBe('up');
    });

    it('returns 503 when the database is unreachable', async () => {
      prisma.ping.mockRejectedValue(Object.assign(new Error(''), { code: 'ECONNREFUSED' }));

      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);

      expect(res.body.status).toBe('error');
      expect(res.body.checks.database).toMatchObject({ status: 'down', error: 'ECONNREFUSED' });
    });

    it('returns 503 when Redis is not connected', async () => {
      redisClient.status = 'reconnecting';

      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);

      expect(res.body.checks.redis.status).toBe('down');
      expect(redisClient.ping).not.toHaveBeenCalled();
    });
  });

  describe('API versioning and errors', () => {
    it('does not serve unversioned routes', async () => {
      await request(app.getHttpServer()).get('/api/health').expect(404);
    });

    it('returns the standard error envelope for unknown routes', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);

      expect(res.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Cannot GET /api/v1/does-not-exist',
        path: '/api/v1/does-not-exist',
        method: 'GET',
        timestamp: expect.any(String),
        requestId: res.headers['x-request-id'],
      });
    });
  });

  describe('Global validation', () => {
    it('accepts a valid payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/validation-probe')
        .send({ name: 'Tomato seedlings', quantity: 3 })
        .expect(201);

      expect(res.body).toEqual({ name: 'Tomato seedlings', quantity: 3 });
    });

    it('rejects invalid fields with 400 and lists every violation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/validation-probe')
        .send({ name: 42, quantity: 0 })
        .expect(400);

      expect(res.body.error).toBe('Bad Request');
      expect(res.body.message).toEqual(
        expect.arrayContaining(['name must be a string', 'quantity must not be less than 1']),
      );
    });

    it('rejects properties that are not part of the DTO', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/validation-probe')
        .send({ name: 'Maize', quantity: 1, role: 'admin' })
        .expect(400);

      expect(res.body.message).toContain('property role should not exist');
    });
  });

  describe('Swagger', () => {
    it('serves the OpenAPI document with versioned paths', async () => {
      const res = await request(app.getHttpServer()).get('/api/docs/json').expect(200);

      expect(res.body.openapi).toMatch(/^3\./);
      expect(res.body.info.title).toBe('MenyaMuhinzi API');
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining(['/api/v1/health', '/api/v1/health/live']),
      );
      expect(res.body.components.securitySchemes['access-token']).toMatchObject({
        type: 'http',
        scheme: 'bearer',
      });
    });

    it('documents the authentication and user-management endpoints with their security', async () => {
      const res = await request(app.getHttpServer()).get('/api/docs/json').expect(200);
      const paths = res.body.paths as Record<string, Record<string, { security?: unknown[] }>>;

      const expected: [string, string][] = [
        ['post', '/api/v1/auth/register'],
        ['post', '/api/v1/auth/login'],
        ['post', '/api/v1/auth/logout'],
        ['post', '/api/v1/auth/refresh'],
        ['post', '/api/v1/auth/change-password'],
        ['post', '/api/v1/auth/forgot-password'],
        ['post', '/api/v1/auth/reset-password'],
        ['get', '/api/v1/auth/me'],
        ['get', '/api/v1/users'],
        ['post', '/api/v1/users'],
        ['get', '/api/v1/users/{id}'],
        ['patch', '/api/v1/users/{id}'],
        ['patch', '/api/v1/users/{id}/status'],
        ['patch', '/api/v1/users/{id}/roles'],
        ['get', '/api/v1/roles'],
        ['get', '/api/v1/roles/permissions'],
        ['put', '/api/v1/roles/{code}/permissions'],
        ['post', '/api/v1/accounts/requests'],
        ['get', '/api/v1/accounts/requests'],
        ['get', '/api/v1/accounts/requests/{id}'],
        ['post', '/api/v1/accounts/requests/{id}/approve'],
        ['post', '/api/v1/accounts/requests/{id}/reject'],
        ['get', '/api/v1/farmers'],
        ['post', '/api/v1/farmers'],
        ['get', '/api/v1/farmers/{id}'],
        ['patch', '/api/v1/farmers/{id}'],
        ['get', '/api/v1/facilitators'],
        ['post', '/api/v1/facilitators'],
        ['get', '/api/v1/facilitators/{id}'],
        ['patch', '/api/v1/facilitators/{id}'],
        ['post', '/api/v1/admin/groups'],
        ['get', '/api/v1/admin/groups'],
        ['get', '/api/v1/admin/groups/{id}'],
        ['patch', '/api/v1/admin/groups/{id}'],
        ['delete', '/api/v1/admin/groups/{id}'],
        ['post', '/api/v1/facilitator/groups'],
        ['get', '/api/v1/facilitator/groups'],
        ['get', '/api/v1/facilitator/groups/{id}'],
        ['patch', '/api/v1/facilitator/groups/{id}'],
        ['delete', '/api/v1/facilitator/groups/{id}'],
        ['post', '/api/v1/facilitator/groups/{id}/members'],
        ['get', '/api/v1/facilitator/groups/{id}/members'],
        ['delete', '/api/v1/facilitator/groups/{id}/members/{userId}'],
        ['post', '/api/v1/facilitator/groups/{id}/courses'],
        ['get', '/api/v1/facilitator/groups/{id}/courses'],
        ['get', '/api/v1/crops'],
        ['post', '/api/v1/crops'],
        ['patch', '/api/v1/crops/{id}'],
        ['delete', '/api/v1/crops/{id}'],
        ['post', '/api/v1/courses'],
        ['get', '/api/v1/courses'],
        ['get', '/api/v1/courses/{id}'],
        ['patch', '/api/v1/courses/{id}'],
        ['delete', '/api/v1/courses/{id}'],
        ['post', '/api/v1/courses/{id}/modules'],
        ['get', '/api/v1/courses/{id}/modules'],
        ['patch', '/api/v1/modules/{id}'],
        ['delete', '/api/v1/modules/{id}'],
        ['post', '/api/v1/modules/{id}/lessons'],
        ['get', '/api/v1/modules/{id}/lessons'],
        ['patch', '/api/v1/lessons/{id}'],
        ['delete', '/api/v1/lessons/{id}'],
        ['post', '/api/v1/courses/{id}/publish'],
        ['post', '/api/v1/courses/{id}/unpublish'],
        ['get', '/api/v1/courses/{id}/publications'],
        ['post', '/api/v1/courses/{courseId}/enrollments'],
        ['get', '/api/v1/enrollments'],
        ['get', '/api/v1/enrollments/{id}'],
        ['post', '/api/v1/enrollments/{id}/withdraw'],
        ['patch', '/api/v1/enrollments/{id}/status'],
        ['get', '/api/v1/enrollments/{id}/progress'],
        ['put', '/api/v1/lessons/{id}/progress'],
        ['get', '/api/v1/lessons/{id}/content'],
        ['post', '/api/v1/lessons/{id}/resources'],
        ['get', '/api/v1/lessons/{id}/resources'],
        ['post', '/api/v1/learning-sessions'],
        ['post', '/api/v1/learning-sessions/{id}/complete'],
        ['post', '/api/v1/assessments'],
        ['get', '/api/v1/assessments'],
        ['post', '/api/v1/assessments/{id}/attempts'],
        ['post', '/api/v1/assessment-attempts/{id}/submit'],
        ['post', '/api/v1/assessment-attempts/{id}/review'],
        ['post', '/api/v1/knowledge/sources'],
        ['get', '/api/v1/knowledge/sources'],
        ['get', '/api/v1/knowledge/sources/{id}'],
        ['patch', '/api/v1/knowledge/sources/{id}'],
        ['delete', '/api/v1/knowledge/sources/{id}'],
        ['post', '/api/v1/knowledge/sources/{id}/versions'],
        ['post', '/api/v1/knowledge/sources/{id}/process'],
        ['get', '/api/v1/knowledge/sources/{id}/processing-status'],
        ['get', '/api/v1/knowledge/sources/{id}/history'],
        ['post', '/api/v1/knowledge/sources/{id}/submit-review'],
        ['post', '/api/v1/knowledge/sources/{id}/approve'],
        ['post', '/api/v1/knowledge/sources/{id}/reject'],
        ['post', '/api/v1/knowledge/sources/{id}/archive'],
        ['get', '/api/v1/knowledge/sources/{id}/chunks'],
        ['get', '/api/v1/knowledge/chunks/{id}'],
        ['get', '/api/v1/knowledge/topics'],
        ['patch', '/api/v1/knowledge/topics/{id}'],
        ['get', '/api/v1/knowledge/glossary'],
        ['delete', '/api/v1/knowledge/glossary/{id}'],
        ['get', '/api/v1/knowledge/search'],
        ['post', '/api/v1/knowledge/embedding-configurations/{id}/activate'],
        ['get', '/api/v1/admin/ai/assistants'],
        ['post', '/api/v1/admin/ai/assistants'],
        ['patch', '/api/v1/admin/ai/assistants/{id}'],
        ['put', '/api/v1/admin/ai/assistants/{id}/prompts'],
        ['post', '/api/v1/admin/ai/assistants/{id}/archive'],
        ['get', '/api/v1/admin/ai/assistants/{id}/history'],
        ['post', '/api/v1/admin/ai/models'],
        ['post', '/api/v1/admin/ai/models/{id}/deactivate'],
        ['post', '/api/v1/admin/ai/model-configurations'],
        ['post', '/api/v1/admin/ai/model-configurations/{id}/activate'],
        ['post', '/api/v1/admin/ai/prompts/{id}/versions'],
        ['get', '/api/v1/admin/ai/prompts/{id}/versions/{versionId}'],
        ['post', '/api/v1/admin/ai/prompts/{id}/default-version'],
        ['patch', '/api/v1/admin/ai/safety-policies/{id}'],
        ['get', '/api/v1/admin/ai/usage'],
        ['get', '/api/v1/admin/ai/usage/summary'],
        ['get', '/api/v1/admin/ai/requests/{id}'],
        ['get', '/api/v1/admin/ai/conversations/{id}'],
        ['get', '/api/v1/ai/assistants'],
        ['post', '/api/v1/ai/conversations'],
        ['get', '/api/v1/ai/conversations/{id}'],
        ['get', '/api/v1/ai/conversations/{id}/messages'],
        ['post', '/api/v1/ai/conversations/{id}/messages'],
        ['get', '/api/v1/ai/requests/{id}'],
        ['post', '/api/v1/ai/requests/{id}/cancel'],
        ['get', '/api/v1/notifications'],
        ['get', '/api/v1/notifications/unread-count'],
        ['post', '/api/v1/notifications/read-all'],
        ['get', '/api/v1/notifications/{id}'],
        ['post', '/api/v1/notifications/{id}/read'],
        ['post', '/api/v1/notifications/{id}/unread'],
        ['post', '/api/v1/notifications/{id}/archive'],
        ['get', '/api/v1/notification-preferences'],
        ['patch', '/api/v1/notification-preferences'],
        ['get', '/api/v1/admin/notifications/templates'],
        ['post', '/api/v1/admin/notifications/templates'],
        ['get', '/api/v1/admin/notifications/templates/{id}'],
        ['patch', '/api/v1/admin/notifications/templates/{id}'],
        ['get', '/api/v1/admin/notifications/templates/{id}/history'],
        ['post', '/api/v1/admin/notifications/templates/{id}/versions'],
        ['post', '/api/v1/admin/notifications/templates/{id}/preview'],
        ['post', '/api/v1/admin/notifications/templates/{id}/activate'],
        ['post', '/api/v1/admin/notifications/templates/{id}/deactivate'],
        ['post', '/api/v1/admin/notifications/templates/{id}/archive'],
        ['get', '/api/v1/admin/notifications/categories'],
        ['patch', '/api/v1/admin/notifications/categories/{category}'],
        ['get', '/api/v1/admin/notifications/channels'],
        ['patch', '/api/v1/admin/notifications/channels/{channel}'],
        ['get', '/api/v1/admin/notifications/deliveries'],
      ];
      for (const [method, path] of expected) {
        expect(paths[path]?.[method]).toBeDefined();
      }

      const publicRoutes = ['register', 'login', 'refresh', 'forgot-password', 'reset-password'];
      for (const route of publicRoutes) {
        expect(paths[`/api/v1/auth/${route}`].post.security).toBeUndefined();
      }
      expect(paths['/api/v1/users'].get.security).toEqual([{ 'access-token': [] }]);
    });

    it('serves the Swagger UI', async () => {
      const res = await request(app.getHttpServer()).get('/api/docs').expect(200);

      expect(res.text).toContain('swagger-ui');
    });
  });
});
