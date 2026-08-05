import { Router } from 'express';
import { CriminalRecordController } from './criminal-record.controller';
import { CriminalRecordService } from './criminal-record.service';
import { CriminalRecordRepository } from './criminal-record.repository';
import { UserRepository } from '@modules/auth/user.repository';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { requireAbility } from '@middleware/require-ability';
import { setCriminalRecordStatusSchema, userIdParamSchema } from './criminal-record.validator';

/**
 * Criminal-record feature module: a read-only status for the user under
 * `/api/criminal-record/*` (only `service_provider` goes through this
 * onboarding gate — see `defineAbilitiesFor`), admin-set results under
 * `/api/admin/criminal-record/*` — mirrors the KYC module's user/admin route
 * split. There is no user-facing submission: the check itself happens
 * outside this app (a real vendor integration, deferred); an admin records
 * the outcome directly.
 */
export const createCriminalRecordModule = (): { userRouter: Router; adminRouter: Router } => {
  const criminalRecord = new CriminalRecordRepository();
  const users = new UserRepository();
  const criminalRecordService = new CriminalRecordService(criminalRecord);
  const controller = new CriminalRecordController(criminalRecordService);
  const requireProvider = requireAbility(users, 'read', 'CriminalRecord');
  const requireAdmin = requireAbility(users, 'manage', 'all');

  const userRouter = Router();

  /**
   * @openapi
   * /api/criminal-record/me:
   *   get:
   *     tags: [Criminal Record]
   *     summary: Get the authenticated user's criminal-record check status
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/CriminalRecordCheck' }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   */
  userRouter.get('/me', requireAuth, requireProvider, controller.me);

  const adminRouter = Router();

  /**
   * @openapi
   * /api/admin/criminal-record/{userId}:
   *   patch:
   *     tags: [Criminal Record]
   *     summary: Set a user's criminal-record check result (admin only)
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/SetCriminalRecordStatusRequest' }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/CriminalRecordCheck' }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not an admin }
   *       422: { description: Validation failed }
   */
  adminRouter.patch(
    '/:userId',
    requireAuth,
    requireAdmin,
    validate({ params: userIdParamSchema, body: setCriminalRecordStatusSchema }),
    controller.setStatus
  );

  return { userRouter, adminRouter };
};
