import 'express';

declare global {
  namespace Express {
    interface Request {
      /** Unique identifier attached to every incoming request. */
      id: string;
      /** Authenticated user's id, set by the `requireAuth` middleware. */
      userId?: string;
    }
  }
}

export {};
