import { StatusCodes } from 'http-status-codes';

/**
 * Base class for all application errors. Carries an HTTP status code and an
 * `isOperational` flag that distinguishes expected errors (bad input, not found)
 * from unexpected programmer errors.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = StatusCodes.INTERNAL_SERVER_ERROR,
    isOperational = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** @public — part of the error toolkit; thrown by resource modules (see /scaffold-module). */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, StatusCodes.NOT_FOUND);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, StatusCodes.BAD_REQUEST);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, StatusCodes.UNAUTHORIZED);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, StatusCodes.FORBIDDEN);
  }
}

export class ValidationError extends AppError {
  public readonly details: unknown;

  constructor(message = 'Validation failed', details?: unknown) {
    super(message, StatusCodes.UNPROCESSABLE_ENTITY);
    this.details = details;
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, StatusCodes.CONFLICT);
  }
}
