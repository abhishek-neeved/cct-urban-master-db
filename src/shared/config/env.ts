import dotenv from 'dotenv';
import { z } from 'zod';
import {
  BCRYPT_SALT_ROUNDS,
  DEFAULT_ACCESS_SECRET,
  DEFAULT_RAZORPAY_KEY_ID,
  DEFAULT_RAZORPAY_KEY_SECRET,
  DEFAULT_RAZORPAY_PLAN_ID,
  DEFAULT_RAZORPAY_WEBHOOK_SECRET,
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

    // This API's own base URL (used in Swagger's server list, not in emails).
    APP_URL: z.string().url().default(ENV_DEFAULTS.APP_URL),
    // web-app's public URL — used to build the password-reset link emailed to
    // users (@modules/auth). Mobile has no equivalent web page to link to;
    // the mobile app's forgot-password flow relies on this same web page
    // being reachable from a phone browser, since a mobileapp:// deep link
    // can't be delivered reliably via email across all mail clients.
    WEB_APP_URL: z.string().url().default(ENV_DEFAULTS.WEB_APP_URL),

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
    // How long an account stays locked after LOGIN_MAX_ATTEMPTS wrong passwords.
    LOGIN_LOCKOUT_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(ENV_DEFAULTS.LOGIN_LOCKOUT_MINUTES),

    // Comma-separated list of allowed CORS origins (leave empty to allow all in dev).
    CORS_ORIGINS: z.string().optional(),

    // Object storage (S3-compatible) for uploaded files (see @modules/uploads).
    S3_BUCKET: z.string().min(1).default('cdma-uploads-dev'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    // Custom endpoint for a non-AWS S3-compatible provider or a local MinIO
    // instance in dev; leave unset to use AWS's default endpoint resolution.
    S3_ENDPOINT: z.string().url().optional(),
    // Required when S3_ENDPOINT is set (MinIO has no ambient AWS credentials to
    // fall back to); optional against real AWS, where the SDK's default
    // provider chain (IAM role, shared config, etc.) can supply them instead.
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    // MinIO (and most non-AWS S3-compatible services) require path-style
    // addressing (`endpoint/bucket/key`); AWS itself defaults to virtual-hosted
    // style (`bucket.endpoint/key`) and only needs this when using an endpoint
    // override that doesn't support it.
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

    // Razorpay (see @modules/subscriptions). Test-mode keys (rzp_test_...) work
    // against the same API in dev — there's no separate sandbox host.
    RAZORPAY_KEY_ID: z.string().min(1).default(DEFAULT_RAZORPAY_KEY_ID),
    RAZORPAY_KEY_SECRET: z.string().min(1).default(DEFAULT_RAZORPAY_KEY_SECRET),
    // The Plan created once via the Razorpay dashboard/API for the ₹10/month
    // plan — not created programmatically by this app.
    RAZORPAY_PLAN_ID: z.string().min(1).default(DEFAULT_RAZORPAY_PLAN_ID),
    // Shared secret configured on the webhook endpoint in the Razorpay
    // dashboard; used to verify `X-Razorpay-Signature` on incoming webhooks.
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1).default(DEFAULT_RAZORPAY_WEBHOOK_SECRET),
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

    // A custom endpoint (MinIO, or any non-AWS S3-compatible service) has no
    // ambient credentials to fall back to, unlike real AWS (IAM role, shared
    // config, etc. via the SDK's default provider chain) — so static keys are
    // required whenever one is set.
    if (val.S3_ENDPOINT && (!val.S3_ACCESS_KEY_ID || !val.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_ACCESS_KEY_ID'],
        message: 'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when S3_ENDPOINT is set',
      });
    }

    // Never boot production still pointed at placeholder Razorpay config — a
    // real key/secret/plan/webhook-secret must be set, same guard shape as
    // JWT_ACCESS_SECRET above.
    const razorpayDefaults: Array<[keyof typeof val, string]> = [
      ['RAZORPAY_KEY_ID', DEFAULT_RAZORPAY_KEY_ID],
      ['RAZORPAY_KEY_SECRET', DEFAULT_RAZORPAY_KEY_SECRET],
      ['RAZORPAY_PLAN_ID', DEFAULT_RAZORPAY_PLAN_ID],
      ['RAZORPAY_WEBHOOK_SECRET', DEFAULT_RAZORPAY_WEBHOOK_SECRET],
    ];
    if (val.NODE_ENV === 'production') {
      for (const [key, placeholder] of razorpayDefaults) {
        if (val[key] === placeholder) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must be set to a real value in production`,
          });
        }
      }
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
