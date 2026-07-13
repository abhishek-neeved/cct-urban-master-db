import { vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { validate } from '@middleware/validate';

const run = (schemas: Parameters<typeof validate>[0], req: Partial<Request>) => {
  const next = vi.fn() as unknown as NextFunction;
  validate(schemas)(req as Request, {} as Response, next);
  return next as unknown as ReturnType<typeof vi.fn>;
};

describe('validate', () => {
  it('replaces params, query, and body with parsed/coerced values then calls next()', () => {
    const req: Partial<Request> = {
      params: { id: '42' },
      query: { page: '2' } as Request['query'],
      body: { name: '  Ada  ' },
    };
    const next = run(
      {
        params: z.object({ id: z.coerce.number() }),
        query: z.object({ page: z.coerce.number() }),
        body: z.object({ name: z.string().trim() }),
      },
      req
    );

    expect(next).toHaveBeenCalledWith();
    expect(req.params).toEqual({ id: 42 });
    expect(req.query).toEqual({ page: 2 });
    expect(req.body).toEqual({ name: 'Ada' });
  });

  it('is a no-op passthrough when no schemas are supplied', () => {
    const next = run({}, { body: { untouched: true } });
    expect(next).toHaveBeenCalledWith();
  });

  it('forwards a ZodError to next() when validation fails', () => {
    const next = run({ body: z.object({ name: z.string() }) }, { body: {} });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
  });
});
