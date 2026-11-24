import { plainToInstance, Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateBy,
  validateSync,
} from 'class-validator';
import { DURATION_PATTERN } from '../common/utils/duration';

const DURATION_MESSAGE = '$property must be a duration such as 30s, 15m, 12h or 7d';

function decodeAes256Key(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 ? key : undefined;
}

export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
  Silent = 'silent',
}

// Reads the raw value: implicit conversion would otherwise coerce the string "false" to `true`.
const toBoolean = ({ obj, key, value }: TransformFnParams): unknown => {
  const raw: unknown = obj[key] ?? value;
  if (typeof raw !== 'string') return raw;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return raw;
};

export class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @IsString()
  @IsNotEmpty()
  APP_NAME: string = 'MenyaMuhinzi API';

  @IsInt()
  @Min(1)
  @Max(65535)
  APP_PORT: number = 4000;

  @IsString()
  @IsNotEmpty()
  API_PREFIX: string = 'api';

  @IsString()
  @IsNotEmpty()
  API_VERSION: string = '1';

  @IsString()
  CORS_ORIGINS: string = '*';

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  @Transform(toBoolean)
  @IsBoolean()
  LOG_PRETTY: boolean = false;

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED: boolean = true;

  @IsString()
  @IsNotEmpty()
  SWAGGER_PATH: string = 'api/docs';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string = 'localhost';

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsInt()
  @Min(0)
  REDIS_DB: number = 0;

  @IsString()
  @IsNotEmpty()
  QUEUE_PREFIX: string = 'menyamuhinzi';

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  /** HMAC key used to hash refresh and password-reset tokens before storage. */
  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsString()
  @IsNotEmpty()
  JWT_ISSUER: string = 'menyamuhinzi-api';

  @IsString()
  @IsNotEmpty()
  JWT_AUDIENCE: string = 'menyamuhinzi-clients';

  @IsInt()
  @Min(1)
  AUTH_MAX_FAILED_LOGINS: number = 5;

  @IsInt()
  @Min(1)
  AUTH_LOCKOUT_MINUTES: number = 15;

  @IsInt()
  @Min(5)
  AUTH_PASSWORD_RESET_TTL_MINUTES: number = 30;

  @Transform(toBoolean)
  @IsBoolean()
  AUTH_FARMER_REQUIRES_APPROVAL: boolean = true;

  /** Development aid: return the reset token in the API response. Never honoured in production. */
  @Transform(toBoolean)
  @IsBoolean()
  AUTH_EXPOSE_RESET_TOKEN: boolean = false;

  @IsInt()
  @Min(1)
  RATE_LIMIT_TTL_SECONDS: number = 60;

  @IsInt()
  @Min(1)
  RATE_LIMIT_MAX: number = 120;

  @IsInt()
  @Min(1)
  AUTH_RATE_LIMIT_MAX: number = 10;

  /** Directory for uploaded knowledge files. File bytes are never stored in PostgreSQL. */
  @IsString()
  @IsNotEmpty()
  KNOWLEDGE_STORAGE_DIR: string = './storage/knowledge';

  @IsInt()
  @Min(1024)
  @Max(200 * 1024 * 1024)
  KNOWLEDGE_MAX_FILE_BYTES: number = 20 * 1024 * 1024;

  @IsInt()
  @Min(200)
  @Max(8000)
  KNOWLEDGE_CHUNK_SIZE: number = 1200;

  /** Must not exceed half of KNOWLEDGE_CHUNK_SIZE; checked when the pipeline starts. */
  @IsInt()
  @Min(0)
  @Max(4000)
  KNOWLEDGE_CHUNK_OVERLAP: number = 150;

  @IsInt()
  @Min(1)
  @Max(5000)
  KNOWLEDGE_MAX_PAGES: number = 500;

  @IsInt()
  @Min(1000)
  KNOWLEDGE_EXTRACTION_TIMEOUT_MS: number = 60_000;

  @IsInt()
  @Min(32)
  @Max(4096)
  KNOWLEDGE_EXTRACTION_MEMORY_MB: number = 256;

  @IsInt()
  @Min(1)
  @Max(10)
  KNOWLEDGE_JOB_ATTEMPTS: number = 3;

  @Transform(toBoolean)
  @IsBoolean()
  KNOWLEDGE_WORKER_ENABLED: boolean = true;

  @IsInt()
  @Min(1)
  @Max(16)
  KNOWLEDGE_WORKER_CONCURRENCY: number = 2;

  @Transform(toBoolean)
  @IsBoolean()
  AI_WORKER_ENABLED: boolean = true;

  @IsInt()
  @Min(1)
  @Max(16)
  AI_WORKER_CONCURRENCY: number = 2;

  @IsInt()
  @Min(1)
  @Max(10)
  AI_REQUEST_ATTEMPTS: number = 3;

  /** Upper bound on retrieved knowledge text placed into an assembled prompt. */
  @IsInt()
  @Min(500)
  @Max(200_000)
  AI_CONTEXT_MAX_CHARS: number = 8000;

  @Transform(toBoolean)
  @IsBoolean()
  NOTIFICATIONS_WORKER_ENABLED: boolean = true;

  @IsInt()
  @Min(1)
  @Max(32)
  NOTIFICATIONS_WORKER_CONCURRENCY: number = 4;

  @IsInt()
  @Min(1)
  @Max(10)
  NOTIFICATIONS_DELIVERY_ATTEMPTS: number = 3;

  @IsInt()
  @Min(1)
  @Max(365)
  REPORTS_ACTIVE_LEARNER_DAYS: number = 30;

  @IsInt()
  @Min(100)
  @Max(100_000)
  REPORTS_CSV_MAX_ROWS: number = 10_000;

  @IsInt()
  @Min(30)
  @Max(3600)
  USSD_SESSION_TTL_SECONDS: number = 180;

  @IsInt()
  @Min(40)
  @Max(500)
  USSD_MAX_SCREEN_CHARS: number = 160;

  @IsOptional()
  @IsString()
  USSD_CALLBACK_SECRET?: string;

  @IsInt()
  @Min(60)
  @Max(7200)
  IVR_SESSION_TTL_SECONDS: number = 600;

  @IsOptional()
  @IsString()
  IVR_CALLBACK_SECRET?: string;

  /** HMAC-SHA256 key for opaque web-session ids. Must not equal JWT_REFRESH_SECRET. */
  @IsString()
  @MinLength(32)
  WEB_SESSION_HASH_SECRET: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  WEB_SESSION_HASH_SECRET_PREVIOUS?: string;

  /** Base64-encoded 32-byte AES-256-GCM key for refresh tokens stored on web sessions. */
  @ValidateBy({
    name: 'isAes256Key',
    validator: {
      validate: (value: unknown) => decodeAes256Key(value) !== undefined,
      defaultMessage: () => 'WEB_SESSION_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    },
  })
  WEB_SESSION_ENCRYPTION_KEY: string;

  @IsInt()
  @Min(1)
  WEB_SESSION_ENCRYPTION_KEY_VERSION: number = 1;

  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  WEB_SESSION_IDLE_TTL: string = '30m';

  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  WEB_SESSION_ABSOLUTE_TTL: string = '12h';

  @IsInt()
  @Min(100)
  @Max(30_000)
  WEB_SESSION_LOCK_TTL_MS: number = 5000;

  /** Shared with the Vercel TanStack Start BFF only. */
  @IsString()
  @MinLength(32)
  MENYA_BFF_SHARED_SECRET: string;

  /** Public frontend origin used in password-reset links and Google OAuth redirects (no trailing slash). */
  @IsOptional()
  @IsString()
  FRONTEND_SITE_ORIGIN?: string;

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_SECRET?: string;

  @Transform(toBoolean)
  @IsOptional()
  @IsBoolean()
  PASSWORD_RESET_WORKER_ENABLED?: boolean;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  @Transform(toBoolean)
  @IsOptional()
  @IsBoolean()
  SMTP_SECURE?: boolean;

  @IsOptional()
  @IsString()
  TWILIO_ACCOUNT_SID?: string;

  @IsOptional()
  @IsString()
  TWILIO_AUTH_TOKEN?: string;

  @IsOptional()
  @IsString()
  TWILIO_FROM_NUMBER?: string;
}

/**
 * Validates `process.env` at startup so the application fails fast on misconfiguration.
 */
export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  if (validated.WEB_SESSION_HASH_SECRET === validated.JWT_REFRESH_SECRET) {
    throw new Error('WEB_SESSION_HASH_SECRET must be distinct from JWT_REFRESH_SECRET');
  }
  if (
    validated.WEB_SESSION_HASH_SECRET_PREVIOUS &&
    validated.WEB_SESSION_HASH_SECRET_PREVIOUS === validated.WEB_SESSION_HASH_SECRET
  ) {
    throw new Error('WEB_SESSION_HASH_SECRET_PREVIOUS must be distinct from WEB_SESSION_HASH_SECRET');
  }
  const encryptionKey = decodeAes256Key(validated.WEB_SESSION_ENCRYPTION_KEY);
  if (
    !encryptionKey ||
    validated.WEB_SESSION_ENCRYPTION_KEY === validated.JWT_REFRESH_SECRET ||
    encryptionKey.toString('utf8') === validated.JWT_REFRESH_SECRET
  ) {
    throw new Error('WEB_SESSION_ENCRYPTION_KEY must be distinct from JWT_REFRESH_SECRET');
  }

  return validated;
}
