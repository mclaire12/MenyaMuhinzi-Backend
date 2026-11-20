# MenyaMuhinzi Backend

Backend API for **MenyaMuhinzi**, an AI-powered agricultural e-learning platform for Rwandan
farmers. It will serve administrators, agricultural facilitators/agronomists, smartphone farmers
and basic-phone farmers (USSD / IVR).

> **Status: Phase 6 – notification and communication management foundation.** Authentication,
> groups, courses, learning, the knowledge base and the AI foundation remain in place. Users now
> have an in-app notification inbox, multilingual notification templates, delivery tracking and
> communication preferences. **No SMS, email, push, USSD, IVR or other delivery provider is
> connected and no external request is made**: only the in-app inbox delivers. Other channels are
> recorded as skipped or failed with a reason, and nothing is reported as sent without a provider.
> **No AI provider, language model, embedding model or vector database is connected** either.

## Tech stack

| Concern        | Choice                                            |
| -------------- | ------------------------------------------------- |
| Framework      | NestJS 12 (Express) + TypeScript 6                |
| Database       | PostgreSQL 17 via Prisma 7 (`@prisma/adapter-pg`) |
| Cache / queues | Redis 7, BullMQ 6 (`@nestjs/bullmq`)              |
| Logging        | pino (`nestjs-pino`), JSON in production          |
| API docs       | Swagger / OpenAPI (`@nestjs/swagger`)             |
| Validation     | `class-validator` + `class-transformer`           |
| Tests          | Jest 30, `ts-jest`, Supertest                     |
| Containers     | Docker, Docker Compose                            |

## Prerequisites

- Node.js **20.11+** (22 LTS recommended) and npm 10+
- Docker Desktop (for PostgreSQL and Redis), or local PostgreSQL 17 / Redis 7 installations

## Getting started

```bash
# 1. Install dependencies (also generates the Prisma client)
npm install

# 2. Create your local environment file and change the passwords
cp .env.example .env

# 3. Start PostgreSQL and Redis
docker compose up -d postgres redis

# 4. Apply migrations and seed roles, permissions and (optionally) the first administrator
npm run prisma:deploy
npm run db:seed

# 5. Run the API in watch mode
npm run start:dev
```

The API listens on `http://localhost:4000` (port 3000 is left free for the frontend).

| URL                                        | Purpose                                   |
| ------------------------------------------ | ----------------------------------------- |
| `http://localhost:4000/api/v1/health/live` | Liveness: the process is up               |
| `http://localhost:4000/api/v1/health`      | Readiness: PostgreSQL + Redis (200 / 503) |
| `http://localhost:4000/api/docs`           | Swagger UI                                |
| `http://localhost:4000/api/docs/json`      | OpenAPI JSON document                     |

All business endpoints are served under **`/api/v1`** (global prefix `api` + URI versioning).

## npm scripts

| Script                     | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `npm run start:dev`        | Run from source with auto-restart (ts-node + `node --watch`) |
| `npm run start:debug`      | Same, with the Node inspector enabled                        |
| `npm run build`            | Compile to `dist/` with `tsc`                                |
| `npm run start:prod`       | Run the compiled build (`node dist/main`)                    |
| `npm run typecheck`        | Type-check source and tests                                  |
| `npm test`                 | Unit tests                                                   |
| `npm run test:e2e`         | End-to-end HTTP tests (no database or Redis required)        |
| `npm run test:integration` | Integration tests against a real PostgreSQL test database    |
| `npm run test:all`         | Unit, end-to-end and integration tests                       |
| `npm run test:cov`         | Unit tests with coverage report in `coverage/`               |
| `npm run db:seed`          | Seed roles, permissions and the optional first admin         |
| `npm run prisma:generate`  | Regenerate the Prisma client                                 |
| `npm run prisma:migrate`   | Create/apply a development migration                         |
| `npm run prisma:deploy`    | Apply migrations (CI / production)                           |
| `npm run docker:up`        | `docker compose up -d` (PostgreSQL + Redis)                  |
| `npm run docker:down`      | Stop the containers (data volumes are kept)                  |

The Nest CLI is intentionally not used: its v12 toolchain requires Node ≥ 22.22, while plain
`tsc` / `ts-node` work on every supported Node version.

## Project structure

```text
prisma/
  schema.prisma            Prisma schema (users, RBAC, tokens, account requests, profiles)
  migrations/              SQL migrations
  seed.ts, seed-rbac.ts    Idempotent seeding of roles, permissions and the first admin
prisma.config.ts           Prisma CLI config (schema path, migrations, seed, DATABASE_URL)
src/
  main.ts                  Bootstrap: logger, setupApp(), listen
  app.module.ts            Root module
  bootstrap/
    setup-app.ts           /api/v1 routing, CORS, global ValidationPipe, Swagger
    swagger.ts             OpenAPI document + UI
  config/
    configuration.ts       Typed config namespaces (app, logger, swagger, database, redis, queue,
                           jwt, auth, rateLimit)
    env.validation.ts      Fail-fast validation of environment variables
    config.module.ts       Global ConfigModule
  common/
    dto/                   Shared DTOs (error envelope, pagination, location)
    filters/               AllExceptionsFilter (HTTP + Prisma errors -> error envelope)
    rwanda/                Provinces and districts used for location validation
    validation/            Reusable validators (Rwandan phone, email, password policy)
    utils/                 Phone normalisation, durations, error description, connection logging
  infrastructure/
    database/              PrismaModule / PrismaService (global)
    redis/                 RedisModule / RedisService (global, shared ioredis client)
    queue/                 BullMQ root config + registered queues
    logger/                pino structured logging with request ids
  health/                  /health and /health/live endpoints
  modules/
    auth/                  Login, tokens, password flows, global guards and decorators
    users/                 User administration, account provisioning, status policy
    roles/                 RBAC catalogue (rbac.constants.ts) and role-permission management
    account-requests/      Approval workflow (/accounts/requests)
    farmers/, facilitators/ Profiles
    groups, courses, lessons, teaching-materials, enrollments, progress, assessments,
    knowledge/             Knowledge base and retrieval rules (Phase 4)
    ai/                    AI assistants, models, prompts, safety, conversations, orchestration (Phase 5)
    notifications/         Inbox, templates, preferences, settings, delivery, provider interfaces (Phase 6)
    media, ussd, ivr, reports, settings
                           Empty shells for later phases
    feature-modules.ts     Registry of all business modules imported by AppModule
  generated/prisma/        Generated Prisma client (git-ignored)
test/
  app.e2e-spec.ts          End-to-end tests of the HTTP layer
  integration/             Integration tests (*.int-spec.ts) against PostgreSQL
  setup-env.ts             Deterministic test environment
```

Conventions:

- **Infrastructure modules are global** (`PrismaService`, `RedisService`, BullMQ queues), so
  feature modules only import other feature modules.
- **Feature modules** follow `modules/<name>/{<name>.module.ts, controllers, services, dto}`.
- **Configuration** is read only through `ConfigType<typeof xxxConfig>` injection
  (`@Inject(redisConfig.KEY)`), never through `process.env` in business code.

## Configuration

All settings come from environment variables; see [`.env.example`](.env.example) for the full,
documented list. The application validates them at startup and refuses to start on invalid values
(for example a missing `DATABASE_URL` or a non-numeric port).

Secrets are never committed: `.env` and `.env.*` are git-ignored, only `.env.example` is tracked.

## Database (PostgreSQL + Prisma)

- Connection string: `DATABASE_URL`, used by both the app and the Prisma CLI (`prisma.config.ts`).
- Prisma 7 uses the `prisma-client` generator with the `pg` driver adapter; the client is
  generated into `src/generated/prisma` on `npm install`.
- Migrations live in `prisma/migrations`; create new ones with `npm run prisma:migrate` and apply
  them elsewhere with `npm run prisma:deploy`.
- `npm run db:seed` is idempotent. It creates the four system roles and the permission catalogue
  from `src/modules/roles/rbac.constants.ts` and grants the default permissions (grants added
  later by administrators are kept). When `SEED_ADMIN_PASSWORD` is set and no administrator
  exists yet, it also creates the first ACTIVE administrator from `SEED_ADMIN_*`.
- If PostgreSQL is unavailable the API still starts; the outage is logged and `/api/v1/health`
  returns `503`.

## Redis and BullMQ

- `RedisService` wraps a shared ioredis client (caching, health checks). It fails fast instead of
  queueing commands while Redis is unreachable.
- BullMQ uses its own connections built from the same `REDIS_*` settings, with the key prefix
  `QUEUE_PREFIX`. Queues registered so far: `ai-generation` (AI requests), `knowledge` (document
  pipeline), `notification-delivery` (Phase 6 deliveries), `media`, and the legacy `notifications`
  queue, which has no consumer (see `src/infrastructure/queue/queue.constants.ts`). Inject one with
  `@InjectQueue(QueueName.Notifications)`.
- Default job options: 3 attempts with exponential back-off, bounded retention of finished jobs.

## Authentication and authorization

**Every route requires a valid access token** unless it is marked `@Public()` (health checks and
the public auth endpoints). Two global guards run on each request:

1. `AccessTokenGuard` verifies the JWT (HS256, issuer and audience checked), then reloads the user,
   status, roles and permissions from the database. Suspended, inactive, pending or rejected users
   are refused immediately (`403`), and role or permission changes apply on the next request.
   Tokens issued before a password change are rejected.
2. `AuthorizationGuard` enforces `@Authorize({ roles, permissions })`: the user needs **any** of
   the roles and **all** of the permissions.

| Role                 | Default permissions                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN`              | Everything (immutable)                                                                                                                                                                                  |
| `FACILITATOR`        | Farmer support, own farmer groups, reading crops and published courses, assigning those courses, reading approved knowledge, using AI assistants (own conversations), own notifications and preferences |
| `SMARTPHONE_FARMER`  | Learning (courses, progress, assessments), using AI assistants (own conversations), own notifications and preferences                                                                                   |
| `BASIC_PHONE_FARMER` | Same as smartphone farmers                                                                                                                                                                              |

Account lifecycle:

- `POST /auth/register` is the public self-registration for smartphone farmers and facilitators.
  The account is `PENDING` with an account request until an administrator approves it.
  Facilitators always need approval; farmers need it while `AUTH_FARMER_REQUIRES_APPROVAL=true`.
  Rejected applicants may register again.
- Facilitators (and administrators) register farmers, including basic-phone farmers without an
  email or password, with `POST /accounts/requests`. Administrators approve or reject at
  `/accounts/requests/:id/approve|reject`.
- Administrators create active accounts directly with `POST /users`, `/farmers` or
  `/facilitators`. If they leave out the password, the user sets one through forgot-password.
- Phone numbers are accepted in any common Rwandan format (`0788 123 456`, `250788123456`, …)
  and stored as E.164 (`+250788123456`). Users sign in with their email address and password.
  An account without an email cannot sign in. Forgot-password still accepts a phone number or an email.

Tokens and credentials:

- Passwords are hashed with scrypt (`node:crypto`, per-user salt). They need 8–128 characters
  with at least one letter and one digit.
- Access tokens last `JWT_ACCESS_EXPIRES_IN` (default `15m`). Refresh tokens
  (`JWT_REFRESH_EXPIRES_IN`, default `7d`) are random opaque strings. Only their HMAC-SHA256 hash
  is stored. They are single-use: `/auth/refresh` rotates them, and replaying an already-rotated
  token revokes the whole session.
- Logout, password changes, password resets and deactivation revoke refresh tokens.
- Every sign-in attempt is recorded (`login_attempts`). After `AUTH_MAX_FAILED_LOGINS` wrong
  passwords the account is locked for `AUTH_LOCKOUT_MINUTES` (`423`).
- Rate limiting: `RATE_LIMIT_MAX` requests per `RATE_LIMIT_TTL_SECONDS` per IP for all routes.
  The register, login, refresh, change-password, forgot-password and reset-password routes have a
  stricter limit of `AUTH_RATE_LIMIT_MAX` (`429`).
- Forgot-password always answers `202`. For active accounts it stores a hashed single-use token
  (valid `AUTH_PASSWORD_RESET_TTL_MINUTES`) and queues an `auth.password-reset` job on the
  `notifications` queue (SMS, or email when the request used an email). The SMS and email
  processor is not implemented yet. For local testing, `AUTH_EXPOSE_RESET_TOKEN=true` returns the
  token in the response; this is ignored in production.

### Trying it in Swagger

1. Open `http://localhost:4000/api/docs`.
2. `POST /api/v1/auth/login` with the seeded administrator, e.g.
   `{ "email": "admin@menyamuhinzi.rw", "password": "<SEED_ADMIN_PASSWORD>" }`.
3. Copy `accessToken`, click **Authorize**, paste it into `access-token` (no `Bearer ` prefix).
4. Protected endpoints now work; each one's description lists the roles it requires.
   When the access token expires, use `POST /api/v1/auth/refresh` with the refresh token.

## Groups, crops and courses

Two kinds of group are kept separate:

- **Administrator targeting groups** (`/admin/groups`) describe an audience (crop, location, estimated size). They have no member list. `DELETE` deactivates the group so publication history stays intact.
- **Facilitator farmer groups** (`/facilitator/groups`) contain real farmers. A facilitator only sees and changes groups assigned to them; an administrator sees all of them. Members must be active smartphone or basic-phone farmers. Adding a member never creates a second user account.

`GET /crops` returns the seeded crops: Tomatoes (Inyanya), Cabbages (Amashu) and Carrots (Karoti). Administrators can add and deactivate crops.

Courses are created as drafts by administrators, with modules and lessons. `POST /courses/:id/publish` either publishes **platform-wide** or to selected targeting groups, and the publication row is kept after unpublishing. A facilitator can assign a published course to their own group: any platform-wide course, or a targeted course whose crop and location cover that group. Facilitators cannot publish.

Lesson content is a written body plus references to external or uploaded media. The files themselves are not stored in PostgreSQL.

## Learning

Farmers with `courses:read` use the same course endpoints as the catalogue. A course is visible when it is published and the audience matches the farmer (`ALL_FARMERS`, or their own phone type), and one of these is true:

- the current publication is platform-wide;
- the current publication targets a group whose crop is one of the farmer's active groups and whose location covers the farmer;
- the course is assigned to an active facilitator group the farmer belongs to, and a publication is still current.

Unpublished courses are not listed. A smartphone farmer does not receive a basic-phone course, and the reverse is also true.

`POST /courses/:id/enrollments` creates one enrollment per farmer and course. Withdrawing keeps the row; enrolling again reactivates it. Administrators change status at `PATCH /enrollments/:id/status`. Facilitators only see enrollments of farmers in their groups.

`GET /lessons/:id/content` returns the body and resource references for an active or completed enrollment. `PUT /lessons/:id/progress` accepts a percentage; the server sets the status and rejects a lower percentage. Learning sessions (`POST /learning-sessions`) record `WEB`, `USSD`, `IVR`, or `MOBILE` on the same progress row. The session duration is calculated when the session ends. This phase does not call a USSD or IVR provider.

Course progress at `GET /enrollments/:id/progress` is the share of lessons completed. Finishing every lesson marks the enrollment completed.

Assessments belong to one course, module, or lesson. Multiple choice and true/false are scored on the server. Short answers stay ungraded until `POST /assessment-attempts/:id/review`. Farmers do not receive correct answers until an attempt is submitted. A time limit that has already passed cannot be a pass, and `maxAttempts` counts submitted attempts.

## Knowledge base

Administrators (`knowledge:manage`) register sources at `POST /knowledge/sources`, either by uploading a file (multipart field `file`) or by giving a `storageRef`. A storage reference is a key of a file already in knowledge storage, or an `https` URL for HTML, `WEB_ARTICLE` and `OTHER` sources. Uploaded files go to `KNOWLEDGE_STORAGE_DIR`; PostgreSQL only stores the key, size, MIME type and SHA-256 checksum. The file type comes from the content, not the client: executables are refused, and the extension and declared `sourceType` must match.

Each file is a version. Content changes need a new version at `POST /knowledge/sources/:id/versions`, and the same file cannot be added twice to one source.

`POST /knowledge/sources/:id/process` queues the pipeline on the `knowledge` BullMQ queue. PDF, DOCX and TXT can be processed; HTML and URLs can be registered but are not processed yet. Each stage is its own job:

1. **Extraction.** PDF (pdf.js, with page numbers) and DOCX (mammoth, with headings) are parsed in a worker thread with memory, page and time limits. Document scripts, fonts and forms are disabled. TXT must be valid UTF-8.
2. **Normalization.** Text is cleaned, wrapped lines and hyphenated words are joined, page-number lines are dropped, and headings and paragraphs are kept.
3. **Metadata.** The language and the crops and topics mentioned are detected. The source's declared language is kept, and a mismatch is recorded as a warning.
4. **Chunking.** Chunks stay inside one section and start at a heading. A chunk that is split for size repeats `KNOWLEDGE_CHUNK_OVERLAP` characters from the previous one. Each chunk keeps its section title, heading path and page. Empty and duplicate chunks are dropped. Size and overlap are configuration (`KNOWLEDGE_CHUNK_SIZE`, `KNOWLEDGE_CHUNK_OVERLAP`).

A queued or running stage is never queued twice for a version. Temporary failures are retried up to `KNOWLEDGE_JOB_ATTEMPTS` times. Malformed or empty documents fail at once with the reason recorded. Each stage replaces its own output, so a retry does not duplicate data. `GET /knowledge/sources/:id/processing-status` shows the jobs, and `GET /knowledge/sources/:id/history` shows the version, approval, processing and audit history. Set `KNOWLEDGE_WORKER_ENABLED=false` on instances that should not run the worker.

Review: a processed version is submitted (`/submit-review`), then approved or rejected (`/approve`, `/reject` with a reason) by an administrator with `knowledge:approve`. Approving a new version archives the previous approved version; it is kept, not overwritten. Until then the previous approved version stays in use, including when the new one is rejected. Sources that were ever approved cannot be deleted; `/archive` removes them from retrieval.

**Retrieval rule.** Only chunks of the approved version of an active, unarchived source are retrievable (`RETRIEVABLE_CHUNK_WHERE` in `knowledge.constants.ts`). Facilitators (`knowledge:read`) only ever see that knowledge, along with active topics and glossary terms.

Topics (`/knowledge/topics`) are seeded with twelve English names and keywords. The Kinyarwanda names are left for an administrator to enter. The bilingual glossary (`/knowledge/glossary`) stores English and Kinyarwanda terms, descriptions, synonyms and usage examples entered by administrators; nothing is translated automatically. Deleting a topic or term deactivates it.

**Embeddings.** `/knowledge/embedding-configurations` describes a model (provider, model, dimensions, distance metric, version); only one can be active. After chunking, pending `KnowledgeEmbedding` rows are recorded for the active configuration. Vectors are only produced by an `EmbeddingProvider` and stored by a `VectorStore` (see `embeddings/embedding.interfaces.ts`). Neither is registered in this phase, so the embedding job is skipped and rows stay pending. PostgreSQL has no `pgvector` here, so vectors live behind the `VectorStore` interface.

`GET /knowledge/search` filters by title or description (`q`), crop, topic, language, type, status (admin only) and publication date. `mode=semantic` returns `501 Not Implemented` until a provider and vector store are configured; it never returns guessed results.

## AI assistants and orchestration (foundation only)

**What is not there.** No OpenAI, Gemini, Hugging Face, Ollama or other provider is connected. No
real embeddings are generated, no vector database is installed, no semantic search runs, and no
provider API keys are read. The interfaces below prepare for that integration; they do not perform
it. No response is ever presented as model-generated unless a registered provider produced it.

**Administration** (`ADMIN` only, see `ai-*` permissions):

- `/admin/ai/assistants`: assistants with a type (`GENERAL_AGRICULTURE`, `CROP_SPECIFIC`,
  `FARMER_LEARNING`, `FACILITATOR_SUPPORT` or any new upper-case identifier), purpose, supported
  and default language, crops, allowed roles, knowledge access, chunk limit and whether answers
  must cite sources. Created as `DRAFT`; only `ACTIVE` assistants can be used. Every change stores
  a snapshot (`GET /:id/history`) and an audit entry. `PUT /:id/prompts` links prompt templates.
- `/admin/ai/models`: the model registry (provider id, model name and version, capabilities,
  languages, token limits, non-secret metadata). Keys or values that look like credentials are
  rejected with `400`. `providerRegistered` shows whether code for that provider exists; it is
  always `false` for now. A model used by an active configuration cannot be deactivated or archived.
- `/admin/ai/model-configurations`: versioned primary and optional fallback model per assistant.
  Activation requires active models with the required capabilities and replaces the assistant's
  previous active configuration (one active configuration per assistant, enforced by the database).
- `/admin/ai/prompts`: prompt templates by category and language. Text is stored and versioned,
  never executed. New content is a new version; old versions stay readable; the default version
  can be switched.
- `/admin/ai/safety-policies`: instructions, restrictions, trigger keywords and escalation rules.
  Changing rules adds a version. Active policies are added to prompts and checked by a rule-based
  validator; **they do not guarantee safe AI output**.
- `/admin/ai/usage` and `/admin/ai/usage/summary`: usage per request. Token counts and costs stay
  `null` unless a provider reports them; nothing is estimated.
- `/admin/ai/requests` and `/admin/ai/conversations`: oversight. Viewing another user's request or
  conversation is audited.

**Users** (`ai-assistants:read`, `ai-conversations:manage`; farmers and facilitators have both):
`GET /ai/assistants` lists active assistants offered to the caller's roles.
`/ai/conversations` starts, lists, renames, archives and closes the caller's own conversations;
other users' conversations return `404`. `POST /ai/conversations/:id/messages` stores the message
(sequence numbers are assigned atomically; a repeated `clientRequestId` returns the original) and
creates an AI request. `GET /ai/requests/:id` shows its status; `POST /ai/requests/:id/cancel`
cancels it while queued.

**Request lifecycle.** `CREATED` → `QUEUED` (job on the `ai-generation` queue, job id = request id)
→ `PROCESSING` → `COMPLETED` / `FAILED` / `CANCELLED`. The message response includes
`execution.providerConfigured` and a plain notice. Today the outcome is always `FAILED` with
`AI_MODEL_CONFIGURATION_MISSING` (no active configuration) or `AI_PROVIDER_NOT_CONFIGURED`. No
assistant message is created, a usage record with `NOT_AVAILABLE` and null figures is written, and
the job is not retried. Only transient provider errors are retried (`AI_REQUEST_ATTEMPTS`).

**Pipeline** (`src/modules/ai/orchestration/`): `KnowledgeRetriever` → `ContextBuilder` →
`PromptAssembler` → `AiProvider` → `ResponseValidator`, coordinated by `AiOrchestratorService`.
Retrieval uses the Phase 4 semantic search and the approved-knowledge rule only. Without an
embedding provider and vector store it reports `UNAVAILABLE`, and assistants that require sources
fail with `AI_KNOWLEDGE_UNAVAILABLE` instead of answering without them. Source references are
re-checked against the approval rule before they are stored. The validator checks structure,
missing or invented citations, uncited quantities and policy keywords. These are basic checks, not
proof that advice is correct or safe.

**Adding a real provider later:** implement `AiProvider` (`ai.interfaces.ts`), read its credentials
from its own environment variables or a secret store (never from model records), bind it in
`AiModule` with `{ provide: AI_PROVIDERS, useFactory: ... }`, register a model whose `provider`
equals the implementation's `id`, and activate a model configuration. For retrieval, bind an
`EmbeddingProvider` and a `VectorStore` in `KnowledgeModule` and activate an embedding
configuration. The integration tests use clearly marked test doubles (`test/fixtures/ai-test-doubles.ts`);
their output is stored with `isTestData=true`.

Set `AI_WORKER_ENABLED=false` on instances that should not consume the AI queue.

## Notifications and communication (foundation only)

**What is not there.** No MTN or Airtel SMS, third-party SMS gateway, SMTP or email service, Firebase
Cloud Messaging, WhatsApp, USSD aggregator or IVR/voice provider is connected, no provider
credentials are read, and no external network request is made. The provider interfaces prepare for
that integration; they do not perform it. **Only the in-app inbox delivers.** A notification is
never reported as sent or delivered when no provider handled it.

**Notifications.** Categories: `ACCOUNT`, `ACCOUNT_APPROVAL`, `COURSE`, `LEARNING`, `ASSESSMENT`,
`GROUP`, `FACILITATOR`, `SYSTEM`, `SECURITY`, `GENERAL`. Channels: `IN_APP`, `SMS`, `EMAIL`, `PUSH`,
`USSD`, `IVR`. One notification can have several channels, each with its own delivery record.
There is no public "send" endpoint: notifications are created internally from business events
(`NotificationPublisher`), which currently covers account approval and rejection, account status
changes, password changes, course enrollment, group membership and assessment review. Publishing
never fails the business operation that triggered it. A `dedupeKey` makes a call idempotent.

Users (`notifications:read`, `notifications:manage`; facilitators and both farmer roles have both):

- `GET /notifications` (filters `read`, `category`, `archived`; archived are hidden by default),
  `GET /notifications/unread-count` (total and per category), `GET /notifications/:id` (with
  per-channel delivery status), `POST /notifications/:id/read|unread|archive`,
  `POST /notifications/read-all` (optionally for one category). Other users' notifications return `404`.
- `GET, PATCH /notification-preferences`: preferred language, time zone, quiet hours (a window may
  cross midnight), an account-level switch for non-essential notifications, and per-channel and
  per-category switches.

**Delivery statuses.** `QUEUED`, `PROCESSING`, `SENT` (a provider accepted it), `DELIVERED`
(confirmed; only the in-app inbox reaches this today), `FAILED`, `SKIPPED`. Each failure or skip has
a reason code such as `NOTIFICATION_PROVIDER_NOT_CONFIGURED`, `NOTIFICATION_CHANNEL_DISABLED`,
`NOTIFICATION_CHANNEL_NOT_SUPPORTED`, `NOTIFICATION_NO_ADDRESS`, `NOTIFICATION_TEMPLATE_MISSING`,
`NOTIFICATION_CHANNEL_DISABLED_BY_USER` or `NOTIFICATION_QUEUE_UNAVAILABLE`. A database constraint
also refuses `SENT` or `DELIVERED` on an external channel without a provider id. Deliveries from
test providers carry `isTestData=true`.

**Preferences and policy.**

- Basic-phone farmers support `IN_APP`, `SMS`, `USSD` and `IVR`; email and push are not offered and
  never required. Other accounts support `IN_APP`, `SMS`, `EMAIL` and `PUSH`. The inbox cannot be
  turned off.
- A user can only enable a channel that is supported for the account, enabled by an administrator,
  backed by a registered provider, and (for email) has an address. Turning a channel off is always
  allowed.
- `ACCOUNT`, `ACCOUNT_APPROVAL` and `SECURITY` are locked as essential: users and administrators
  cannot disable them, they reach the inbox regardless of preferences or quiet hours, and they are
  not held back by quiet hours on other channels. A user's explicit opt-out of a channel is still
  respected. Quiet hours delay non-essential external deliveries until the window ends.

**Templates** (`notification-templates:read|manage`, admin only, `/admin/notifications/templates`).
A template is identified by `code` + `channel` + `language` (`en` or `rw`) and has a name,
description, category, optional subject, body, typed variable definitions (`string`, `number`,
`date`), version and status (`DRAFT`, `ACTIVE`, `INACTIVE`, `ARCHIVED`). Administrators create,
update metadata, add versions (old ones stay readable), choose the current version, preview,
activate, deactivate, archive (system templates cannot be archived) and read the history. Bodies
use `{{name}}` placeholders; variables are validated against the definitions before every render,
and values are inserted as plain text. Length limits apply per channel (for example SMS 480,
USSD 160 characters). **Templates are never translated automatically.** If no active template exists
in the user's language, an active template in the other language is used and the language used is
recorded on the delivery.

> **Kinyarwanda copy needs native review.** The built-in Kinyarwanda system templates are seeded as
> `DRAFT` and are not used until a native speaker reviews and activates them. English templates are
> `ACTIVE`.

**Settings** (`notification-settings:read|manage`, `notification-deliveries:read`, admin only):
`GET, PATCH /admin/notifications/categories[/:category]` (activate a category, restrict allowed
channels; locked categories cannot be changed), `GET, PATCH /admin/notifications/channels[/:channel]`
(a channel can only be enabled when a provider is registered for it) and
`GET /admin/notifications/deliveries` (status, channel, user and test-data filters; no message
text). All changes are audited.

**Adding a real provider later:** implement `NotificationProvider` (`id`, `channels`, `send`), throw
`NotificationProviderError` with `retryable=true` for transient failures, read its credentials from
its own environment variables or a secret store, bind it in `NotificationsModule` with
`{ provide: NOTIFICATION_PROVIDERS, useFactory: ... }`, then enable the channel as an administrator.
Provider error messages are never stored. For confirmed delivery (`DELIVERED`), add a provider
receipt handler; none exists yet. The integration tests use a clearly marked test provider
(`test/fixtures/notification-test-doubles.ts`).

**Queues.** Deliveries use the new `notification-delivery` queue (job id = delivery id). The older
`notifications` queue still receives `password-reset` jobs from `AuthService` that contain the reset
token in plaintext and have no consumer; this predates Phase 6 and is not changed here. Set
`NOTIFICATIONS_WORKER_ENABLED=false` on instances that should not consume deliveries.

## Error responses

Every error uses the same envelope:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["name must be a string"],
  "path": "/api/v1/courses",
  "method": "POST",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "requestId": "4f1c2a0e-7c1b-4b8e-9d3a-0f1e2d3c4b5a"
}
```

Unexpected errors return a generic `500` message; details are only written to the logs.
Prisma `P2002`/`P2003` map to `409`, `P2025` to `404`.

## Logging

pino structured logs, one JSON object per line, including `service`, `env` and a request id.
The request id is taken from the incoming `x-request-id` header (or generated) and returned in the
response header. `Authorization` and cookie headers are redacted. Set `LOG_PRETTY=true` for
human-readable output in development (ignored in production).

## Docker

```bash
# Databases only (typical local development)
docker compose up -d postgres redis

# Databases + API container
docker compose --profile app up -d --build

# Stop everything (add -v to also delete data volumes)
docker compose --profile app down
```

Each service has a health check and its own named volume, so PostgreSQL and Redis can be started,
stopped and restarted independently.

## Testing

```bash
npm test                  # unit tests
npm run test:e2e          # end-to-end tests
npm run test:integration  # integration tests (needs PostgreSQL)
npm run test:all          # all of the above
npm run test:cov          # coverage
```

The end-to-end suite boots the real `AppModule` (config, logging, validation, filters, Swagger,
versioning) and replaces PostgreSQL, Redis and BullMQ with test doubles, so it runs without Docker.

The integration suite boots the full application against a real PostgreSQL database; Redis and
the queues are still test doubles. The database is `TEST_DATABASE_URL` when set, otherwise
`DATABASE_URL` with `_test` appended to the database name (e.g. `menyamuhinzi_test`). The global
setup creates it if needed, applies migrations and seeds the roles. Tests then truncate it between
cases, and the setup refuses to run against any database whose name does not end in `_test`.

## Roadmap

Phase 0 foundation → Phase 1 authentication & users → Phase 2 groups & courses →
Phase 3 learning → Phase 4 knowledge base & RAG foundation → Phase 5 AI assistant management &
orchestration foundation → Phase 6 notification & communication foundation (current) → real AI
provider integration, real SMS/email/push providers, media delivery, and USSD/IVR providers.

See [docs/architecture.md](docs/architecture.md) and [docs/api-modules.md](docs/api-modules.md).
