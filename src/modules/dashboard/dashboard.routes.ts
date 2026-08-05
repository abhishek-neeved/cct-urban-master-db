import { Router } from 'express';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { UserRepository } from '@modules/auth/user.repository';
import { KycService } from '@modules/kyc/kyc.service';
import { KycRepository } from '@modules/kyc/kyc.repository';
import { KycOtpRepository } from '@modules/kyc/kyc-otp.repository';
import { HttpMobileVerificationProvider } from '@shared/services/mobile-verification.service';
import { CriminalRecordService } from '@modules/criminal-record/criminal-record.service';
import { CriminalRecordRepository } from '@modules/criminal-record/criminal-record.repository';
import { OnboardingFeeService } from '@modules/onboarding-fee/onboarding-fee.service';
import { OnboardingFeeRepository } from '@modules/onboarding-fee/onboarding-fee.repository';
import { RazorpayGateway } from '@shared/services/payment-gateway.service';
import { requireAuth } from '@middleware/require-auth';

/**
 * Dashboard feature module: a thin read-only composition over auth/kyc/
 * criminal-record/onboarding-fee. Each dependency chain is reconstructed here
 * rather than reused from those modules' own `create<X>Module()` factories —
 * those only return `Router`s, not the underlying service, and there's no
 * shared service registry in this codebase. The duplication is a few lines
 * of wiring per module, consistent with every module already being fully
 * self-contained.
 */
export const createDashboardModule = (): Router => {
  const users = new UserRepository();
  // Dashboard only reads KYC status (getStatus) — never verifies/submits —
  // but KycService's constructor needs the same dependencies regardless.
  const kycService = new KycService(
    new KycRepository(),
    new KycOtpRepository(),
    new HttpMobileVerificationProvider()
  );
  const criminalRecordService = new CriminalRecordService(new CriminalRecordRepository());
  const onboardingFeeService = new OnboardingFeeService(
    new OnboardingFeeRepository(),
    users,
    new RazorpayGateway()
  );
  const dashboardService = new DashboardService(
    users,
    kycService,
    criminalRecordService,
    onboardingFeeService
  );
  const controller = new DashboardController(dashboardService);

  const router = Router();

  /**
   * @openapi
   * /api/dashboard/me:
   *   get:
   *     tags: [Dashboard]
   *     summary: Get the authenticated user's dashboard summary
   *     description: >
   *       Composes profile essentials, KYC status, criminal-record status,
   *       and onboarding-fee payment status into one response — everything a
   *       dashboard screen needs from a single request.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DashboardSummary' }
   *       401: { description: Missing/invalid access token }
   *       404: { description: User no longer exists }
   */
  router.get('/me', requireAuth, controller.me);

  return router;
};
