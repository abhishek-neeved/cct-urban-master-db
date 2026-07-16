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

/** Number of digits in an account-verification OTP. */
export const OTP_LENGTH = 6;

/**
 * Wrong-code attempts allowed against a single OTP before it is invalidated.
 * A 6-digit code has only 10^6 possibilities, so capping attempts is what keeps
 * it from being brute-forced; the user must request a fresh code after this.
 */
export const OTP_MAX_ATTEMPTS = 5;

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
  OTP_TTL_MINUTES: 10,
  OTP_RESEND_COOLDOWN_SECONDS: 60,
} as const;

/** Recognised deployment environments. */
export const NODE_ENVS = ['development', 'test', 'production'] as const;

/** Recognised log levels (Winston). */
export const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'debug'] as const;

/** Recognised log output formats. When unset, JSON is used in production and
 * pretty/colourised output elsewhere (resolved in env.ts). */
export const LOG_FORMATS = ['json', 'pretty'] as const;
