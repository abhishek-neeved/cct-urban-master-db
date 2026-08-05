import { Router } from 'express';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycRepository } from './kyc.repository';
import { KycOtpRepository } from './kyc-otp.repository';
import { HttpMobileVerificationProvider } from '@shared/services/mobile-verification.service';
import { UserRepository } from '@modules/auth/user.repository';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { requireAbility } from '@middleware/require-ability';
import {
  confirmMobileOtpSchema,
  listForReviewQuerySchema,
  rejectKycSchema,
  requestMobileVerificationSchema,
  submitKycSchema,
  userIdParamSchema,
  verifyAadhaarSchema,
  verifyPanSchema,
} from './kyc.validator';

/**
 * KYC feature module: user-facing verification/submission under
 * `/api/kyc/*` (only `service_provider` goes through this onboarding gate —
 * see `defineAbilitiesFor`), admin review under `/api/admin/kyc/*` — one
 * obvious boundary for every ability-gated route, mirroring how
 * `/api/auth/*` and `/api/users/*` are already split by concern rather than
 * by role inline in each route.
 */
export const createKycModule = (): { userRouter: Router; adminRouter: Router } => {
  const kyc = new KycRepository();
  const otps = new KycOtpRepository();
  const users = new UserRepository();
  const mobileVerificationProvider = new HttpMobileVerificationProvider();
  const kycService = new KycService(kyc, otps, mobileVerificationProvider);
  const controller = new KycController(kycService);
  const requireProvider = requireAbility(users, 'read', 'Kyc');
  const requireAdmin = requireAbility(users, 'manage', 'all');

  const userRouter = Router();

  /**
   * @openapi
   * /api/kyc/me:
   *   get:
   *     tags: [KYC]
   *     summary: Get the authenticated user's KYC status and verification progress
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
  userRouter.get('/me', requireAuth, requireProvider, controller.me);

  /**
   * @openapi
   * /api/kyc/verify-mobile/request:
   *   post:
   *     tags: [KYC]
   *     summary: Request an OTP to verify a mobile number
   *     description: >
   *       The first step of KYC — Aadhaar/PAN verification requires this to
   *       succeed first. Re-requesting for a different mobile number
   *       replaces any pending OTP.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/RequestMobileVerificationRequest' }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/RequestMobileVerificationResult' }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   *       422: { description: Validation failed }
   */
  userRouter.post(
    '/verify-mobile/request',
    requireAuth,
    requireProvider,
    validate({ body: requestMobileVerificationSchema }),
    controller.requestMobileVerification
  );

  /**
   * @openapi
   * /api/kyc/verify-mobile/confirm:
   *   post:
   *     tags: [KYC]
   *     summary: Confirm the OTP sent for mobile-number verification
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/ConfirmOtpRequest' }
   *     responses:
   *       200:
   *         description: Mobile number verified
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/KycRecord' }
   *       400: { description: Invalid or expired verification code }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   *       422: { description: Validation failed }
   */
  userRouter.post(
    '/verify-mobile/confirm',
    requireAuth,
    requireProvider,
    validate({ body: confirmMobileOtpSchema }),
    controller.confirmMobileOtp
  );

  /**
   * @openapi
   * /api/kyc/verify-aadhaar:
   *   post:
   *     tags: [KYC]
   *     summary: Verify an Aadhaar number against the verified mobile number
   *     description: >
   *       Requires the mobile number to already be verified. Looks up the
   *       Aadhaar/PAN linked to the verified mobile number and compares the
   *       last 4 digits against the submitted Aadhaar number — that's the
   *       only part of the real number the lookup ever discloses.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/VerifyAadhaarRequest' }
   *     responses:
   *       200:
   *         description: Aadhaar verified
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/KycRecord' }
   *       400: { description: Mobile number not verified yet, or Aadhaar does not match }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   *       422: { description: Validation failed }
   */
  userRouter.post(
    '/verify-aadhaar',
    requireAuth,
    requireProvider,
    validate({ body: verifyAadhaarSchema }),
    controller.verifyAadhaar
  );

  /**
   * @openapi
   * /api/kyc/verify-pan:
   *   post:
   *     tags: [KYC]
   *     summary: Verify a PAN against the verified mobile number
   *     description: >
   *       Requires the mobile number to already be verified. Looks up the
   *       PAN linked to the verified mobile number and compares it against
   *       the submitted PAN.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/VerifyPanRequest' }
   *     responses:
   *       200:
   *         description: PAN verified
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/KycRecord' }
   *       400: { description: Mobile number not verified yet, or PAN does not match }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   *       422: { description: Validation failed }
   */
  userRouter.post(
    '/verify-pan',
    requireAuth,
    requireProvider,
    validate({ body: verifyPanSchema }),
    controller.verifyPan
  );

  /**
   * @openapi
   * /api/kyc/submit:
   *   post:
   *     tags: [KYC]
   *     summary: Submit (or resubmit, after a rejection) KYC for review
   *     description: >
   *       Rejects with 400 if the caller is already verified, already has a
   *       submission pending review, or hasn't verified mobile/Aadhaar/PAN
   *       yet (see `/verify-mobile/*`, `/verify-aadhaar`, `/verify-pan`).
   *       A resubmission after rejection clears the previous rejection
   *       reason and re-enters the queue as `pending`.
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
   *       400: { description: Already verified, already pending, or mobile/Aadhaar/PAN not yet verified }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   *       422: { description: Validation failed }
   */
  userRouter.post(
    '/submit',
    requireAuth,
    requireProvider,
    validate({ body: submitKycSchema }),
    controller.submit
  );

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
