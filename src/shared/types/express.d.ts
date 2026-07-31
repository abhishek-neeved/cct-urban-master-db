import 'express';

declare global {
  namespace Express {
    interface Request {
      /** Unique identifier attached to every incoming request. */
      id: string;
      /** Authenticated user's id, set by the `requireAuth` middleware. */
      userId?: string;
      /** Raw request body bytes, captured by express.json()'s `verify` hook (see app.ts) for webhook signature checks. */
      rawBody?: Buffer;
    }
  }
}

export {};
