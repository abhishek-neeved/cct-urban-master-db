import { vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { errorHandler, notFoundHandler } from '@middleware/error-handler';
import { AppError, NotFoundError, ValidationError } from '@utils/errors';

const mockRes = () => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const req = { id: 'req-1', method: 'GET', originalUrl: '/missing' } as unknown as Request;
const next = vi.fn() as unknown as NextFunction;

describe('notFoundHandler', () => {
  it('responds 404 with the method and url in the message', () => {
    const res = mockRes();
    notFoundHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: 'Route GET /missing not found' }),
      })
    );
  });
});

describe('errorHandler', () => {
  it('maps a ZodError to 422 with flattened field errors', () => {
    const res = mockRes();
    const zodErr = z.object({ name: z.string() }).safeParse({}).error!;
    errorHandler(zodErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.UNPROCESSABLE_ENTITY);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: 'Validation failed' }),
      })
    );
  });

  it('maps an operational AppError to its status code', () => {
    const res = mockRes();
    errorHandler(new NotFoundError('User'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: 'User not found' }),
      })
    );
  });

  it('includes details for a ValidationError', () => {
    const res = mockRes();
    errorHandler(new ValidationError('bad', { field: 'x' }), req, res, next);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.UNPROCESSABLE_ENTITY);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'bad', details: { field: 'x' } }),
      })
    );
  });

  it('logs (as error) a non-operational AppError but still maps its status', () => {
    const res = mockRes();
    errorHandler(new AppError('kaboom', StatusCodes.BAD_GATEWAY, false), req, res, next);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_GATEWAY);
  });

  it('maps an unknown Error to a generic 500', () => {
    const res = mockRes();
    errorHandler(new Error('leaky detail'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'Internal server error' }),
      })
    );
  });

  it('coerces a non-Error thrown value into a 500', () => {
    const res = mockRes();
    errorHandler('a bare string', req, res, next);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
  });
});
