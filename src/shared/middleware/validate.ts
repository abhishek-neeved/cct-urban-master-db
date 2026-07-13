import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export interface RequestSchemas {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
}

/**
 * Validation layer: a middleware factory that validates the request against the
 * given Zod schemas *before* the controller runs. Parsed (and coerced) values
 * replace the originals, so controllers receive already-validated data. Any
 * failure is forwarded to the centralised error handler as a ZodError.
 */
export const validate =
  (schemas: RequestSchemas) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        // Express 5 exposes `req.query` as a getter-only property, so it can't be
        // reassigned; redefine it as an own property with the parsed value instead.
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
