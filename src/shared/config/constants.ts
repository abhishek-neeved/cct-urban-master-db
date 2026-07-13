/**
 * Static configuration values: environment defaults and validation bounds.
 * Kept out of `env.ts` so the schema there stays declarative and these values
 * have a single, greppable home.
 */

/** Fallback JWT access secret for local dev — rejected in production (see env.ts). */
export const DEFAULT_ACCESS_SECRET = 'dev-access-secret-change-me';

/** Minimum length required for the JWT access secret in production. */
export const MIN_PROD_SECRET_LENGTH = 32;

/** Allowed range for bcrypt salt rounds (floor kept high enough to be costly). */
export const BCRYPT_SALT_ROUNDS = { min: 10, max: 15, default: 12 } as const;

/** Default values applied when an environment variable is unset. */
export const ENV_DEFAULTS = {
  NODE_ENV: 'development',
  PORT: 3000,
  LOG_LEVEL: 'info',
  MONGO_URI: 'mongodb://127.0.0.1:27017/cdma_master_db',
  APP_URL: 'http://localhost:3000',
  JWT_ACCESS_EXPIRES_IN: '15m',
  REFRESH_TOKEN_TTL_DAYS: 7,
  PASSWORD_RESET_TTL_MINUTES: 60,
} as const;

/** Recognised deployment environments. */
export const NODE_ENVS = ['development', 'test', 'production'] as const;

/** Recognised log levels (Winston). */
export const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'debug'] as const;
