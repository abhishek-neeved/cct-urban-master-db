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

/**
 * Wrong-password attempts allowed against a single account before it is
 * temporarily locked. Blunts distributed brute-force against one account that
 * per-IP rate limiting (`@middleware/rate-limit`) wouldn't catch on its own.
 */
export const LOGIN_MAX_ATTEMPTS = 5;

/**
 * Grace window (ms) after a refresh token is rotated during which presenting
 * the old token again is treated as a benign race (e.g. two requests firing
 * near-simultaneously — a double-tab refresh, a retried network call) rather
 * than a theft replay. At the storage layer both look identical (the old
 * token is already marked used) — time since rotation is the only signal that
 * tells them apart. A replay presented after this window has elapsed is
 * treated as reuse and revokes the whole refresh-token family (see
 * `refresh-token.repository`'s `rotate`).
 */
export const REFRESH_TOKEN_REUSE_GRACE_MS = 1000;

/** Default values applied when an environment variable is unset. */
export const ENV_DEFAULTS = {
  NODE_ENV: 'development',
  PORT: 3000,
  LOG_LEVEL: 'info',
  DATABASE_URL: 'mongodb://127.0.0.1:27017/express_ts_layered',
  APP_URL: 'http://localhost:3000',
  JWT_ACCESS_EXPIRES_IN: '15m',
  REFRESH_TOKEN_TTL_DAYS: 7,
  PASSWORD_RESET_TTL_MINUTES: 60,
  OTP_TTL_MINUTES: 10,
  OTP_RESEND_COOLDOWN_SECONDS: 60,
  LOGIN_LOCKOUT_MINUTES: 15,
} as const;

/** Recognised deployment environments. */
export const NODE_ENVS = ['development', 'test', 'production'] as const;

/** Recognised log levels (Winston). */
export const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'debug'] as const;

/** Recognised log output formats. When unset, JSON is used in production and
 * pretty/colourised output elsewhere (resolved in env.ts). */
export const LOG_FORMATS = ['json', 'pretty'] as const;

/** Cookie names auth tokens are mirrored into (see `@utils/cookie.util`). */
export const ACCESS_TOKEN_COOKIE = 'accessToken';
export const REFRESH_TOKEN_COOKIE = 'refreshToken';
