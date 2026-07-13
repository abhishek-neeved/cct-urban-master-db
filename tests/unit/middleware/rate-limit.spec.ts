import { vi } from 'vitest';
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { rateLimitExceededHandler } from '@middleware/rate-limit';

describe('rateLimitExceededHandler', () => {
  it('responds 429 with the standard error envelope', () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    rateLimitExceededHandler({ id: 'req-1' } as Request, res);

    expect(res.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: 'Too many requests, please try again later' }),
        requestId: 'req-1',
      })
    );
  });
});
