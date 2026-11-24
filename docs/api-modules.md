# API modules

All paths are relative to `/api/v1`. Full request and response schemas are in Swagger at
`/api/docs` (JSON at `/api/docs/json`). Authenticated routes need `Authorization: Bearer <token>`.

## Phases 0–4

| Module             | Paths                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Health             | `health`, `health/live`                                                                                                                         |
| Auth               | `auth/*` (login, refresh, logout, current user, password)                                                                                       |
| Users, roles       | `users`, `roles`                                                                                                                                |
| Account requests   | `accounts/requests`                                                                                                                             |
| Farmers            | `farmers`                                                                                                                                       |
| Facilitators       | `facilitators`, `facilitator/groups`                                                                                                            |
| Crops              | `crops`                                                                                                                                         |
| Groups             | `admin/groups`                                                                                                                                  |
| Courses            | `courses`, `courses/:id/modules`, `modules`, `modules/:id/lessons`, `lessons`                                                                   |
| Teaching materials | under `courses` / `lessons`                                                                                                                     |
| Enrollments        | `courses/:courseId/enrollments`, `enrollments`                                                                                                  |
| Progress           | `lessons/:id/content`, `lessons/:id/progress`, `learning-sessions`, `enrollments/:id/progress`                                                  |
| Assessments        | `assessments`, `assessment-questions`, `assessment-attempts`                                                                                    |
| Knowledge          | `knowledge/sources`, `knowledge/chunks/:id`, `knowledge/topics`, `knowledge/glossary`, `knowledge/search`, `knowledge/embedding-configurations` |

## AI (Phase 5)

No AI provider is configured. These endpoints manage configuration and track requests; none of
them generates an AI answer. See [architecture.md](architecture.md#ai-foundation-phase-5).

### Permissions

| Permission                                  | Granted to                            |
| ------------------------------------------- | ------------------------------------- |
| `ai-assistants:read`                        | Admin, facilitator, both farmer roles |
| `ai-conversations:manage`                   | Admin, facilitator, both farmer roles |
| `ai-assistants:manage`                      | Admin                                 |
| `ai-models:read`, `ai-models:manage`        | Admin                                 |
| `ai-prompts:read`, `ai-prompts:manage`      | Admin                                 |
| `ai-safety:read`, `ai-safety:manage`        | Admin                                 |
| `ai-conversations:read`, `ai-requests:read` | Admin (oversight)                     |
| `ai-usage:read`                             | Admin                                 |

### Administration

| Method and path                                                   | Purpose                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET, POST admin/ai/assistants`                                   | List (filters, pagination) / create (`DRAFT`)                            |
| `GET, PATCH admin/ai/assistants/:id`                              | Read / update (stores a version snapshot)                                |
| `PUT admin/ai/assistants/:id/prompts`                             | Replace linked prompt templates                                          |
| `POST admin/ai/assistants/:id/activate\|deactivate\|archive`      | Status changes                                                           |
| `GET admin/ai/assistants/:id/history`                             | Version snapshots                                                        |
| `GET, POST admin/ai/models`                                       | Model registry (`providerRegistered` is always `false` today)            |
| `GET, PATCH admin/ai/models/:id`                                  | Read / update (secret-like metadata rejected)                            |
| `POST admin/ai/models/:id/activate\|deactivate\|archive`          | Blocked while used by an active configuration                            |
| `GET admin/ai/models/:id/history`                                 | Version snapshots                                                        |
| `GET, POST admin/ai/model-configurations`                         | Primary and fallback model per assistant                                 |
| `GET admin/ai/model-configurations/:id`                           | Read                                                                     |
| `POST admin/ai/model-configurations/:id/activate\|deactivate`     | One active configuration per assistant                                   |
| `GET, POST admin/ai/prompts`                                      | Prompt templates (stored, never executed)                                |
| `GET, PATCH admin/ai/prompts/:id`                                 | Read / update metadata                                                   |
| `GET, POST admin/ai/prompts/:id/versions`                         | Version list / new version                                               |
| `GET admin/ai/prompts/:id/versions/:versionId`                    | One version                                                              |
| `POST admin/ai/prompts/:id/default-version`                       | Choose the default version                                               |
| `POST admin/ai/prompts/:id/activate\|deactivate\|archive`         | Status changes                                                           |
| `GET, POST admin/ai/safety-policies`                              | Safety policies                                                          |
| `GET, PATCH admin/ai/safety-policies/:id`                         | Read / update (rule changes add a version)                               |
| `GET admin/ai/safety-policies/:id/versions`                       | Versions                                                                 |
| `POST admin/ai/safety-policies/:id/activate\|deactivate\|archive` | Status changes                                                           |
| `GET admin/ai/usage`, `GET admin/ai/usage/summary`                | Usage records; tokens and cost are `null` unless a provider reports them |
| `GET admin/ai/requests[/:id]`                                     | Request oversight (viewing others is audited)                            |
| `GET admin/ai/conversations[/:id]`                                | Conversation oversight (viewing others is audited)                       |

### Users

| Method and path                            | Purpose                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `GET ai/assistants[/:id]`                  | Active assistants offered to the caller's roles                            |
| `POST, GET ai/conversations`               | Start / list own conversations                                             |
| `GET, PATCH ai/conversations/:id`          | Read / rename own conversation (others return `404`)                       |
| `POST ai/conversations/:id/archive\|close` | Archive or close                                                           |
| `GET ai/conversations/:id/messages`        | Messages in order                                                          |
| `POST ai/conversations/:id/messages`       | Store a message and create an AI request (idempotent on `clientRequestId`) |
| `GET ai/requests/:id`                      | Request status, error code and stored source references                    |
| `POST ai/requests/:id/cancel`              | Cancel while `CREATED` or `QUEUED`                                         |

The message response contains `execution.providerConfigured` (always `false` today) and a notice:
"No AI provider is configured; no AI response will be generated." The request then fails with
`AI_MODEL_CONFIGURATION_MISSING` or `AI_PROVIDER_NOT_CONFIGURED`.

### AI error codes

`AI_PROVIDER_NOT_CONFIGURED`, `AI_MODEL_CONFIGURATION_MISSING`, `AI_MODEL_CONFIGURATION_INVALID`,
`AI_ASSISTANT_UNAVAILABLE`, `AI_KNOWLEDGE_UNAVAILABLE`, `AI_PROMPT_INCOMPLETE`, `AI_PROVIDER_ERROR`,
`AI_RESPONSE_VALIDATION_FAILED`, `AI_QUEUE_UNAVAILABLE`.

## Notifications (Phase 6)

No delivery provider is configured. Only the in-app inbox delivers; see
[architecture.md](architecture.md#notification-foundation-phase-6).

### Notification permissions

| Permission                                                     | Granted to                            |
| -------------------------------------------------------------- | ------------------------------------- |
| `notifications:read`, `notifications:manage`                   | Admin, facilitator, both farmer roles |
| `notification-templates:read`, `notification-templates:manage` | Admin                                 |
| `notification-settings:read`, `notification-settings:manage`   | Admin                                 |
| `notification-deliveries:read`                                 | Admin                                 |

### Notification endpoints (own data)

| Method and path                                | Purpose                                                         |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `GET notifications`                            | List own (filters `read`, `category`, `archived`; paginated)    |
| `GET notifications/unread-count`               | Total and per category                                          |
| `POST notifications/read-all`                  | Mark all (optionally one `category`) as read                    |
| `GET notifications/:id`                        | Detail with per-channel delivery status                         |
| `POST notifications/:id/read\|unread\|archive` | State changes (idempotent)                                      |
| `GET, PATCH notification-preferences`          | Language, time zone, quiet hours, channel and category switches |

### Notification administration

| Method and path                                                        | Purpose                                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET, POST admin/notifications/templates`                              | List (filters) / create (`DRAFT`, version 1)                           |
| `GET, PATCH admin/notifications/templates/:id`                         | Read / update metadata (text changes are new versions)                 |
| `GET, POST admin/notifications/templates/:id/versions`                 | Version list / add version (`makeCurrent` optional)                    |
| `GET admin/notifications/templates/:id/versions/:versionId`            | One version                                                            |
| `POST admin/notifications/templates/:id/current-version`               | Choose the current version                                             |
| `POST admin/notifications/templates/:id/preview`                       | Render with sample variables (validated, nothing is sent)              |
| `POST admin/notifications/templates/:id/activate\|deactivate\|archive` | Status changes (system templates cannot be archived)                   |
| `GET admin/notifications/templates/:id/history`                        | Versions and audit entries                                             |
| `GET admin/notifications/categories`, `PATCH .../:category`            | Activation, essential flag, allowed channels (locked ones are refused) |
| `GET admin/notifications/channels`, `PATCH .../:channel`               | Enable a channel (needs a registered provider); inbox always on        |
| `GET admin/notifications/deliveries`                                   | Delivery records (status, channel, user, `isTestData`); no text        |

### Notification error codes

Delivery reason codes: `NOTIFICATION_PROVIDER_NOT_CONFIGURED`, `NOTIFICATION_CHANNEL_DISABLED`,
`NOTIFICATION_CHANNEL_NOT_SUPPORTED`, `NOTIFICATION_CHANNEL_NOT_ALLOWED_FOR_CATEGORY`,
`NOTIFICATION_CHANNEL_DISABLED_BY_USER`, `NOTIFICATION_NO_ADDRESS`, `NOTIFICATION_TEMPLATE_MISSING`,
`NOTIFICATION_TEMPLATE_VARIABLES_INVALID`, `NOTIFICATION_PROVIDER_ERROR`,
`NOTIFICATION_QUEUE_UNAVAILABLE`, `NOTIFICATION_USER_UNAVAILABLE`.

## Reports (Phase 7)

Aggregates over transactional data. See [architecture.md](architecture.md#reporting-foundation-phase-7).
`startDate` is inclusive; `endDate` is exclusive (UTC).

### Report permissions

| Permission                                               | Granted to        |
| -------------------------------------------------------- | ----------------- |
| `reports:read`, `reports:export`                         | Admin             |
| `facilitator-reports:read`, `facilitator-reports:export` | Facilitator       |
| `farmer-reports:read`                                    | Both farmer roles |

### Admin

| Method and path                   | Purpose                                                   |
| --------------------------------- | --------------------------------------------------------- |
| `GET admin/reports/dashboard`     | Institutional overview                                    |
| `GET admin/reports/users`         | Accounts by status and role                               |
| `GET admin/reports/registrations` | Farmer registrations (`format=csv` with `reports:export`) |
| `GET admin/reports/learning`      | Enrollments, channels, active learners                    |
| `GET admin/reports/courses`       | Course catalogue counts                                   |
| `GET admin/reports/assessments`   | Attempt outcomes and pass rates                           |
| `GET admin/reports/facilitators`  | Facilitator activity                                      |
| `GET admin/reports/groups`        | Group membership                                          |
| `GET admin/reports/ai`            | AI requests and usage (null tokens stay null)             |
| `GET admin/reports/knowledge`     | Sources, jobs, chunks                                     |
| `GET admin/reports/notifications` | Delivery aggregates (`format=csv` supported)              |
| `GET admin/reports/system`        | DB-backed queue snapshots, failures, recent audit         |

### Facilitator

| Method and path                       | Purpose                                     |
| ------------------------------------- | ------------------------------------------- |
| `GET facilitator/reports/dashboard`   | Own groups overview                         |
| `GET facilitator/reports/groups`      | Own groups and members (no contact details) |
| `GET facilitator/reports/learning`    | Learning for own farmers                    |
| `GET facilitator/reports/assessments` | Assessments for own farmers                 |

### Farmer

| Method and path                | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `GET farmer/reports/dashboard` | Own enrollments, progress, attempts, unread |
| `GET farmer/reports/progress`  | Own course progress detail                  |

## USSD and IVR (Phase 8)

No telecom aggregator or audio provider is registered by default. Public callbacks require a
configured adapter and its HMAC secret (`USSD_CALLBACK_SECRET` or `IVR_CALLBACK_SECRET`); requests
are rejected when the secret is missing or the provider signature is invalid. The adapter parses
provider-specific payloads and may supply a stable callback id for idempotency. Farmers are matched
using normalized registered phone numbers and active account status, not JWT. A callback cannot
change the owner of an existing session.

### Permissions (admin only)

`ussd:sessions:read|manage`, `ussd:configuration:read|manage`, `ussd:analytics:read`,
`ivr:sessions:read|manage`, `ivr:configuration:read|manage`, `ivr:analytics:read`

### Callbacks

| Method and path    | Purpose                          |
| ------------------ | -------------------------------- |
| `POST ussd/callback` | Signed USSD provider webhook (`@Public`); adapter returns continue/end response |
| `POST ivr/callback`  | Signed IVR provider webhook (`@Public`); adapter formats DTMF/audio commands |

### Admin

| Method and path                              | Purpose                |
| -------------------------------------------- | ---------------------- |
| `GET|PATCH admin/ussd/configuration`       | USSD channel settings  |
| `GET admin/ussd/sessions`                    | List USSD sessions     |
| `GET admin/ussd/sessions/:id`                | Session detail         |
| `POST admin/ussd/sessions/:id/terminate`     | Force-end session      |
| `GET admin/ussd/analytics`                   | Session aggregates     |
| `GET|PATCH admin/ivr/configuration`        | IVR channel settings   |
| `GET admin/ivr/sessions`                     | List IVR sessions      |
| `GET admin/ivr/sessions/:id`                 | Session detail         |
| `POST admin/ivr/sessions/:id/terminate`      | Force-end session      |
| `GET admin/ivr/analytics`                    | Session aggregates     |

USSD offers Kinyarwanda/English menus, visible courses, modules, lessons, lesson-content
pagination, progress, resume and explicit lesson completion. IVR supports language choice and
DTMF navigation through the same published course and lesson catalogue. Lesson audio commands are
created only through a registered `AUDIO_PROVIDERS` implementation; there is no default/mock
playback provider. USSD also supports published multiple-choice and true/false assessments for
enrolled courses, with answers graded by the existing assessment service. Short-answer assessments
and IVR assessment flows are not available. Learning channel and progress state are shared with the
existing WEB/MOBILE APIs.
