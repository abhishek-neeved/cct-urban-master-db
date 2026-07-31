import { Router } from 'express';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycRepository } from './kyc.repository';
import { UserRepository } from '@modules/auth/user.repository';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { requireRole } from '@middleware/require-role';
import {
  listForReviewQuerySchema,
  rejectKycSchema,
  submitKycSchema,
  userIdParamSchema,
} from './kyc.validator';

/**
 * KYC feature module: user-facing submission/status under `/api/kyc/*`, admin
 * review under `/api/admin/kyc/*` — one obvious boundary for every role-gated
 * route, mirroring how `/api/auth/*` and `/api/users/*` are already split by
 * concern rather than by role inline in each route.
 */
export const createKycModule = (): { userRouter: Router; adminRouter: Router } => {
  const kyc = new KycRepository();
  const users = new UserRepository();
  const kycService = new KycService(kyc);
  const controller = new KycController(kycService);
  const requireAdmin = requireRole(users, 'admin');

  const userRouter = Router();

  /**
   * @openapi
   * /api/kyc/me:
   *   get:
   *     tags: [KYC]
   *     summary: Get the authenticated user's KYC status and submitted data
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/KycRecord' }
   *       401: { description: Missing/invalid access token }
   */
  userRouter.get('/me', requireAuth, controller.me);

  /**
   * @openapi
   * /api/kyc/submit:
   *   post:
   *     tags: [KYC]
   *     summary: Submit (or resubmit, after a rejection) identity documents for review
   *     description: >
   *       Rejects with 400 if the caller is already verified or already has a
   *       submission pending review. A resubmission after rejection clears the
   *       previous rejection reason and re-enters the queue as `pending`.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/SubmitKycRequest' }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/KycRecord' }
   *       400: { description: Already verified, or already pending review }
   *       401: { description: Missing/invalid access token }
   *       422: { description: Validation failed }
   */
  userRouter.post('/submit', requireAuth, validate({ body: submitKycSchema }), controller.submit);

  const adminRouter = Router();

  /**
   * @openapi
   * /api/admin/kyc:
   *   get:
   *     tags: [KYC]
   *     summary: List KYC submissions for review (admin only)
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: status
   *         required: false
   *         schema: { type: string, enum: [pending, verified, rejected] }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 records:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/AdminKycRecord' }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not an admin }
   *       422: { description: Validation failed }
   */
  adminRouter.get(
    '/',
    requireAuth,
    requireAdmin,
    validate({ query: listForReviewQuerySchema }),
    controller.listForReview
  );

  /**
   * @openapi
   * /api/admin/kyc/{userId}/approve:
   *   patch:
   *     tags: [KYC]
   *     summary: Approve a pending KYC submission (admin only)
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AdminKycRecord' }
   *       400: { description: The submission is not pending }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not an admin }
   *       404: { description: No KYC submission for this user }
   */
  adminRouter.patch(
    '/:userId/approve',
    requireAuth,
    requireAdmin,
    validate({ params: userIdParamSchema }),
    controller.approve
  );

  /**
   * @openapi
   * /api/admin/kyc/{userId}/reject:
   *   patch:
   *     tags: [KYC]
   *     summary: Reject a pending KYC submission with a reason (admin only)
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
   *           schema: { $ref: '#/components/schemas/RejectKycRequest' }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AdminKycRecord' }
   *       400: { description: The submission is not pending }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not an admin }
   *       404: { description: No KYC submission for this user }
   *       422: { description: Validation failed (reason is required) }
   */
  adminRouter.patch(
    '/:userId/reject',
    requireAuth,
    requireAdmin,
    validate({ params: userIdParamSchema, body: rejectKycSchema }),
    controller.reject
  );

  return { userRouter, adminRouter };
};
