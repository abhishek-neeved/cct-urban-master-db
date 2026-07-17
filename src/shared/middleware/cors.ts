import cors, { CorsOptions } from 'cors';
import { RequestHandler } from 'express';
import { env } from '@config/env';

/**
 * Builds CORS options from a raw comma-separated origins string. When an
 * allowlist is present we restrict to those origins; with none set, `origin:
 * true` reflects whichever origin sent the request (convenient for local dev
 * — the env schema forbids this fallback in production). `credentials: true`
 * is required either way so the auth cookies (`@utils/cookie.util`) actually
 * reach a cross-origin frontend — a literal `*` origin is incompatible with
 * credentialed requests, which is why the no-allowlist case reflects rather
 * than wildcards.
 */
export const resolveCorsOptions = (rawOrigins?: string): CorsOptions => {
  const origins = rawOrigins
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    origin: origins && origins.length > 0 ? origins : true,
    credentials: true,
  };
};

export const corsMiddleware = (): RequestHandler => cors(resolveCorsOptions(env.CORS_ORIGINS));
