import { Router } from 'express';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserRepository } from '@modules/auth/user.repository';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { updateMeSchema } from './users.validator';

/**
 * Users feature module: profile reads/updates that don't belong to auth's
 * credential/session scope. Operates on the same `User` collection as auth
 * (via `UserRepository`) rather than owning a separate model.
 */
export const createUsersModule = (): Router => {
  const users = new UserRepository();
  const usersService = new UsersService(users);
  const controller = new UsersController(usersService);

  const router = Router();

  /**
   * @openapi
   * /api/users/me:
   *   get:
   *     tags: [Users]
   *     summary: Get the authenticated user's profile
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 user: { $ref: '#/components/schemas/User' }
   *       401: { description: Missing/invalid access token }
   *       404: { description: User no longer exists }
   */
  router.get('/me', requireAuth, controller.me);

  /**
   * @openapi
   * /api/users/me:
   *   patch:
   *     tags: [Users]
   *     summary: Update the authenticated user's profile
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/UpdateProfileRequest' }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 user: { $ref: '#/components/schemas/User' }
   *       401: { description: Missing/invalid access token }
   *       404: { description: User no longer exists }
   *       422: { description: Validation failed }
   */
  router.patch('/me', requireAuth, validate({ body: updateMeSchema }), controller.updateMe);

  return router;
};
