import { vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const logger = vi.hoisted(() => ({
  http: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@utils/logger', () => ({ logger }));

const { requestLoggerMiddleware, SLOW_REQUEST_MS } = await import('@middleware/request-logger');

// Minimal req/res doubles: capture the 'finish' handler so tests can fire it,
// expose a settable status code + content-length header, and stub the client
// context (ip, user-agent, referrer) and optional authenticated user id.
const makeReqRes = (statusCode: number, opts: { contentLength?: number; userId?: string } = {}) => {
  const { contentLength = 0, userId } = opts;
  let onFinish = (): void => {};
  const headers: Record<string, string> = {
    'user-agent': 'curl/8.4.0',
    referer: 'https://app.example.com',
  };
  const req = {
    method: 'GET',
    originalUrl: '/api/test',
    ip: '203.0.113.4',
    userId,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = {
    statusCode,
    on(event: string, cb: () => void) {
      if (event === 'finish') onFinish = cb;
      return res;
    },
    getHeader: (name: string) =>
      name.toLowerCase() === 'content-length' ? contentLength : undefined,
  } as unknown as Response;
  return { req, res, finish: () => onFinish() };
};

describe('requestLoggerMiddleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes a sane slow-request threshold', () => {
    expect(SLOW_REQUEST_MS).toBeGreaterThan(0);
  });

  it('logs arrival and a completion line for a fast success, and calls next', () => {
    const next = vi.fn() as unknown as NextFunction;
    const { req, res, finish } = makeReqRes(200, { contentLength: 42 });

    requestLoggerMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.http).toHaveBeenCalledWith(
      'request.received',
      expect.objectContaining({ method: 'GET', path: '/api/test' })
    );

    finish();
    expect(logger.http).toHaveBeenCalledWith(
      'request.completed',
      expect.objectContaining({
        statusCode: 200,
        contentLength: 42,
        method: 'GET',
        path: '/api/test',
        ip: '203.0.113.4',
        userAgent: 'curl/8.4.0',
        referrer: 'https://app.example.com',
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('includes userId when the request is authenticated, and omits it otherwise', () => {
    const authed = makeReqRes(200, { userId: '6a54b659' });
    requestLoggerMiddleware(authed.req, authed.res, vi.fn() as unknown as NextFunction);
    authed.finish();
    expect(logger.http).toHaveBeenCalledWith(
      'request.completed',
      expect.objectContaining({ userId: '6a54b659' })
    );

    vi.clearAllMocks();

    const anon = makeReqRes(200);
    requestLoggerMiddleware(anon.req, anon.res, vi.fn() as unknown as NextFunction);
    anon.finish();
    const meta = logger.http.mock.calls.find((c) => c[0] === 'request.completed')?.[1];
    expect(meta).not.toHaveProperty('userId');
  });

  it('logs at error level for a 5xx response', () => {
    const { req, res, finish } = makeReqRes(500);
    requestLoggerMiddleware(req, res, vi.fn() as unknown as NextFunction);
    finish();
    expect(logger.error).toHaveBeenCalledWith(
      'request.failed',
      expect.objectContaining({ statusCode: 500 })
    );
  });

  it('logs at warn level for a slow request', () => {
    const spy = vi
      .spyOn(process.hrtime, 'bigint')
      .mockReturnValueOnce(0n) // start
      .mockReturnValueOnce(2_000_000_000n); // finish: 2000ms elapsed
    const { req, res, finish } = makeReqRes(200);

    requestLoggerMiddleware(req, res, vi.fn() as unknown as NextFunction);
    finish();

    expect(logger.warn).toHaveBeenCalledWith(
      'request.slow',
      expect.objectContaining({ durationMs: 2000 })
    );
    spy.mockRestore();
  });
});
