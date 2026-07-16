import { StatusCodes } from 'http-status-codes';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@utils/errors';

describe('errors', () => {
  it('AppError defaults to a 500, operational, and names itself after the subclass', () => {
    const err = new AppError('boom');
    expect(err.statusCode).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
    expect(err.isOperational).toBe(true);
    expect(err.name).toBe('AppError');
    expect(err.stack).toBeDefined();
  });

  it('AppError can be marked non-operational with a custom status', () => {
    const err = new AppError('programmer error', StatusCodes.BAD_GATEWAY, false);
    expect(err.statusCode).toBe(StatusCodes.BAD_GATEWAY);
    expect(err.isOperational).toBe(false);
  });

  it('NotFoundError uses the default resource name and a 404', () => {
    const err = new NotFoundError();
    expect(err.message).toBe('Resource not found');
    expect(err.statusCode).toBe(StatusCodes.NOT_FOUND);
    expect(err.name).toBe('NotFoundError');
  });

  it('NotFoundError interpolates a custom resource name', () => {
    expect(new NotFoundError('User').message).toBe('User not found');
  });

  it('BadRequestError → 400 with a default message', () => {
    const err = new BadRequestError();
    expect(err.statusCode).toBe(StatusCodes.BAD_REQUEST);
    expect(err.message).toBe('Bad request');
  });

  it('UnauthorizedError → 401', () => {
    expect(new UnauthorizedError('nope').statusCode).toBe(StatusCodes.UNAUTHORIZED);
  });

  it('ForbiddenError → 403 with a default message', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(StatusCodes.FORBIDDEN);
    expect(err.message).toBe('Forbidden');
    expect(err.name).toBe('ForbiddenError');
  });

  it('ConflictError → 409 with a default message', () => {
    const err = new ConflictError();
    expect(err.statusCode).toBe(StatusCodes.CONFLICT);
    expect(err.message).toBe('Resource already exists');
  });

  it('ValidationError → 422 and carries details (defaulting to undefined)', () => {
    const withDetails = new ValidationError('bad', { field: 'x' });
    expect(withDetails.statusCode).toBe(StatusCodes.UNPROCESSABLE_ENTITY);
    expect(withDetails.details).toEqual({ field: 'x' });
    expect(new ValidationError().details).toBeUndefined();
  });
});
