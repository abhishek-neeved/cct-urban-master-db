import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';
import { AppError, ValidationError } from '@utils/errors';
import { failure } from '@models/api-response';
import { logger } from '@utils/logger';

/** Catch-all for routes that don't match anything. */
export const notFoundHandler = (req: Request, res: Response): void => {
  res
    .status(StatusCodes.NOT_FOUND)
    .json(failure(`Route ${req.method} ${req.originalUrl} not found`, req.id));
};

/**
 * Centralised error handler. Maps known error types to proper status codes and
 * hides internal details for unexpected errors.
 */
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof ZodError) {
    logger.warn('Validation error', { issues: err.issues });
    res
      .status(StatusCodes.UNPROCESSABLE_ENTITY)
      .json(failure('Validation failed', req.id, err.flatten().fieldErrors));
    return;
  }

  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error(err);
    } else {
      logger.warn(`${err.name}: ${err.message}`);
    }
    const details = err instanceof ValidationError ? err.details : undefined;
    res.status(err.statusCode).json(failure(err.message, req.id, details));
    return;
  }

  logger.error(err instanceof Error ? err : new Error(String(err)));
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(failure('Internal server error', req.id));
};
