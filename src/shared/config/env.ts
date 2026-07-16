import dotenv from 'dotenv';
import { z } from 'zod';
import {
  BCRYPT_SALT_ROUNDS,
  DEFAULT_ACCESS_SECRET,
  ENV_DEFAULTS,
  LOG_FORMATS,
  LOG_LEVELS,
  MIN_PROD_SECRET_LENGTH,
  NODE_ENVS,
} from '@config/constants';

// Skip loading .env under Vitest: tests assert the schema defaults and stub the
// vars they need, so a developer's local .env must not leak into process.env
// (VITEST is set by the runner regardless of any NODE_ENV stubbing in a spec).
if (!process.env.VITEST) {
  dotenv.config({ quiet: true });
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default(ENV_DEFAULTS.NODE_ENV),
    PORT: z.coerce.number().int().positive().default(ENV_DEFAULTS.PORT),
    LOG_LEVEL: z.enum(LOG_LEVELS).default(ENV_DEFAULTS.LOG_LEVEL),
    LOG_FORMAT: z.enum(LOG_FORMATS).optional(),
    DATABASE_URL: z.string().min(1).default(ENV_DEFAULTS.DATABASE_URL),

    // Base URL used to build links in emails (e.g. the password-reset link).
    APP_URL: z.string().url().default(ENV_DEFAULTS.APP_URL),

    // Auth — a strong JWT_ACCESS_SECRET is REQUIRED in production (see refine below).
    JWT_ACCESS_SECRET: z.string().min(1).default(DEFAULT_ACCESS_SECRET),
    JWT_ACCESS_EXPIRES_IN: z.string().default(ENV_DEFAULTS.JWT_ACCESS_EXPIRES_IN),
    REFRESH_TOKEN_TTL_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(ENV_DEFAULTS.REFRESH_TOKEN_TTL_DAYS),
    BCRYPT_SALT_ROUNDS: z.coerce
      .number()
      .int()
      .min(BCRYPT_SALT_ROUNDS.min)
      .max(BCRYPT_SALT_ROUNDS.max)
      .default(BCRYPT_SALT_ROUNDS.default),
    PASSWORD_RESET_TTL_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(ENV_DEFAULTS.PASSWORD_RESET_TTL_MINUTES),

    // How long an account-verification OTP stays valid.
    OTP_TTL_MINUTES: z.coerce.number().int().positive().default(ENV_DEFAULTS.OTP_TTL_MINUTES),
    // Minimum wait between OTP resends (blunts email spamming / brute-force setup).
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(ENV_DEFAULTS.OTP_RESEND_COOLDOWN_SECONDS),

    // Comma-separated list of allowed CORS origins (leave empty to allow all in dev).
    CORS_ORIGINS: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // Never boot production with the shared dev secret or a weak one.
    if (
      val.NODE_ENV === 'production' &&
      (val.JWT_ACCESS_SECRET === DEFAULT_ACCESS_SECRET ||
        val.JWT_ACCESS_SECRET.length < MIN_PROD_SECRET_LENGTH)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: `A strong JWT_ACCESS_SECRET (>= ${MIN_PROD_SECRET_LENGTH} chars) must be set in production`,
      });
    }

    // Never fall back to open (reflect-any) CORS in production.
    const hasCorsAllowlist = val.CORS_ORIGINS?.split(',').some((o) => o.trim().length > 0);
    if (val.NODE_ENV === 'production' && !hasCorsAllowlist) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must list at least one allowed origin in production',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Resolved log output format: an explicit LOG_FORMAT wins; otherwise JSON in
 * production (machine-parseable for log aggregators) and pretty/colourised
 * output everywhere else (readable in a dev console).
 */
export const logFormat = env.LOG_FORMAT ?? (isProduction ? 'json' : 'pretty');
