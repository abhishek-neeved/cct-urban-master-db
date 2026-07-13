import { NextFunction, Request, Response } from 'express';
import { logger } from '@utils/logger';

/**
 * Logs one line when a request arrives and one when it finishes, including the
 * status code and elapsed time. Request id is added automatically by the logger.
 */
export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const start = process.hrtime.bigint();

  logger.http(`→ ${req.method} ${req.originalUrl}`);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.http(`← ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
  });

  next();
};
