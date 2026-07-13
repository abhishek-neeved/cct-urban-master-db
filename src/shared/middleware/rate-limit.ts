import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { StatusCodes } from 'http-status-codes';
import type { Request, Response } from 'express';
import { isTest } from '@config/env';
import { failure } from '@models/api-response';

/**
 * Response sent once the limit is exceeded — a 429 in the standard error
 * envelope. Extracted so it can be unit-tested without driving the limiter to
 * its threshold (which is also skipped entirely under test).
 */
export const rateLimitExceededHandler = (req: Request, res: Response): void => {
  res
    .status(StatusCodes.TOO_MANY_REQUESTS)
    .json(failure('Too many requests, please try again later', req.id));
};

/**
 * Strict limiter for credential endpoints (login, register, password reset) to
 * blunt brute-force and enumeration. Disabled under test so the suite isn't
 * throttled. Responses use the standard error envelope.
 */
export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // express-rate-limit v8 renamed `max` to `limit`
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  handler: rateLimitExceededHandler,
});
