import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '@utils/token.util';
import { UnauthorizedError } from '@utils/errors';

/**
 * Guards a route: requires a valid `Authorization: Bearer <accessToken>` header,
 * verifies the JWT, and attaches the user id to `req.userId`. Rejects with 401
 * otherwise.
 */
export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.header('authorization') ?? '';

  if (!header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid Authorization header'));
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const { sub } = verifyAccessToken(token);
    req.userId = sub;
    return next();
  } catch {
    return next(new UnauthorizedError('Invalid or expired access token'));
  }
};
