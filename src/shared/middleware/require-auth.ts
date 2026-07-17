import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '@utils/token.util';
import { UnauthorizedError } from '@utils/errors';
import { ACCESS_TOKEN_COOKIE } from '@config/constants';

/**
 * Guards a route: requires a valid access token, verifies the JWT, and attaches
 * the user id to `req.userId`. Rejects with 401 otherwise. Accepts the token
 * either via `Authorization: Bearer <accessToken>` (non-browser clients) or the
 * `accessToken` cookie set by `@utils/cookie.util` on login/refresh (browser
 * clients) — the header takes precedence when both are present.
 */
export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : req.cookies?.[ACCESS_TOKEN_COOKIE];

  if (!token) {
    return next(new UnauthorizedError('Missing or invalid access token'));
  }

  try {
    const { sub } = verifyAccessToken(token);
    req.userId = sub;
    return next();
  } catch {
    return next(new UnauthorizedError('Invalid or expired access token'));
  }
};
