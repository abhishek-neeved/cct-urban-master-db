import cors, { CorsOptions } from 'cors';
import { RequestHandler } from 'express';
import { env } from '@config/env';

/**
 * Builds CORS options from a raw comma-separated origins string. When an
 * allowlist is present we restrict to those origins; with none set we return
 * `undefined` so cors() reflects any origin (convenient for local dev — the env
 * schema forbids this fallback in production).
 */
export const resolveCorsOptions = (rawOrigins?: string): CorsOptions | undefined => {
  const origins = rawOrigins
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return origins && origins.length > 0 ? { origin: origins } : undefined;
};

export const corsMiddleware = (): RequestHandler => cors(resolveCorsOptions(env.CORS_ORIGINS));
