import { NextFunction, Request, Response } from 'express';
import { logger } from '@utils/logger';

/** Requests that take longer than this (ms) are logged at `warn` level. */
export const SLOW_REQUEST_MS = 1000;

/**
 * Structured request logging: one `request.received` line on arrival and one
 * completion line when the response finishes. The completion line carries
 * queryable fields (method, path, status, duration, response size) rather than
 * a pre-formatted string, so JSON logs can be filtered/aggregated. Its level
 * reflects the outcome — `error` for 5xx, `warn` for slow requests, else
 * `http`. The completion line also carries client context (ip, user-agent,
 * referrer) and the authenticated user id when present. The request id is
 * attached automatically by the logger.
 */
export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const start = process.hrtime.bigint();

  logger.http('request.received', { method: req.method, path: req.originalUrl });

  res.on('finish', () => {
    const durationMs = Number((Number(process.hrtime.bigint() - start) / 1_000_000).toFixed(1));
    const contentLength = Number(res.getHeader('content-length')) || 0;
    // undefined fields are dropped by JSON serialization, so optional context
    // (user-agent, referrer, userId) simply doesn't appear when absent.
    const meta: Record<string, unknown> = {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      contentLength,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      referrer: req.get('referer'),
    };
    if (req.userId) meta.userId = req.userId;

    if (res.statusCode >= 500) {
      logger.error('request.failed', meta);
    } else if (durationMs > SLOW_REQUEST_MS) {
      logger.warn('request.slow', meta);
    } else {
      logger.http('request.completed', meta);
    }
  });

  next();
};
