import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '@utils/errors';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { UserRole } from '@modules/auth/user.types';

/**
 * Guards a route to a set of roles. Must run after `requireAuth` (needs
 * `req.userId`). Looks the user's current role up fresh on every request
 * rather than trusting a role embedded in the access token — the token only
 * ever carries `sub` (see `@utils/token.util`), so a role change (e.g. an
 * admin demotion) takes effect on the user's very next request instead of
 * waiting out the token's remaining lifetime.
 */
export const requireRole =
  (users: IUserRepository, ...allowed: UserRole[]) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      return next(new UnauthorizedError('Missing or invalid access token'));
    }

    const user = await users.findById(req.userId);
    if (!user || !allowed.includes(user.role)) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }

    next();
  };
