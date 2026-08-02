import { NextFunction, Request, Response } from 'express';
import { defineAbilitiesFor, type Action, type Subject } from '@shared/authorization/ability';
import { ForbiddenError, UnauthorizedError } from '@utils/errors';
import type { IUserRepository } from '@modules/auth/user.repository';

/**
 * Guards a route with a CASL ability check instead of a raw role allowlist —
 * one place (`defineAbilitiesFor`) decides what each role can do, and every
 * route just states the action/subject it needs. Must run after
 * `requireAuth` (needs `req.userId`). Looks the user's current role up fresh
 * on every request rather than trusting a role embedded in the access token,
 * same rationale as the `requireRole` middleware this replaces: a role change
 * takes effect on the user's very next request instead of waiting out the
 * token's remaining lifetime.
 */
export const requireAbility =
  (users: IUserRepository, action: Action, subject: Subject) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      return next(new UnauthorizedError('Missing or invalid access token'));
    }

    const user = await users.findById(req.userId);
    if (!user) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }

    const ability = defineAbilitiesFor(user.role);
    if (!ability.can(action, subject)) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }

    next();
  };
