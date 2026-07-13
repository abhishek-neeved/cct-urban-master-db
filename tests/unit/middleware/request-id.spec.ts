import { vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requestIdMiddleware } from '@middleware/request-id';
import { getRequestId } from '@utils/request-context';

const mockReqRes = (incomingId?: string) => {
  const req = {
    header: vi.fn().mockReturnValue(incomingId),
  } as unknown as Request;
  const res = { setHeader: vi.fn() } as unknown as Response;
  return { req, res };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('requestIdMiddleware', () => {
  it('honours a well-formed incoming X-Request-Id and echoes it back', () => {
    const { req, res } = mockReqRes('abc-123_ID.1');
    let seenInContext: string | undefined;
    const next = vi.fn(() => {
      seenInContext = getRequestId();
    }) as unknown as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.id).toBe('abc-123_ID.1');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123_ID.1');
    expect(seenInContext).toBe('abc-123_ID.1');
  });

  it('generates a fresh uuid when no id is present', () => {
    const { req, res } = mockReqRes(undefined);
    requestIdMiddleware(req, res, vi.fn() as unknown as NextFunction);
    expect(req.id).toMatch(UUID_RE);
  });

  it('rejects a malformed incoming id and generates a fresh one instead', () => {
    const { req, res } = mockReqRes('bad id with spaces!!');
    requestIdMiddleware(req, res, vi.fn() as unknown as NextFunction);
    expect(req.id).toMatch(UUID_RE);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.id);
  });
});
