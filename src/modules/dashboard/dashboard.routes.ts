import { Router } from 'express';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { UserRepository } from '@modules/auth/user.repository';
import { KycService } from '@modules/kyc/kyc.service';
import { KycRepository } from '@modules/kyc/kyc.repository';
import { CriminalRecordService } from '@modules/criminal-record/criminal-record.service';
import { CriminalRecordRepository } from '@modules/criminal-record/criminal-record.repository';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { SubscriptionsRepository } from '@modules/subscriptions/subscriptions.repository';
import { RazorpayGateway } from '@shared/services/payment-gateway.service';
import { requireAuth } from '@middleware/require-auth';

/**
 * Dashboard feature module: a thin read-only composition over auth/kyc/
 * criminal-record/subscriptions. Each dependency chain is reconstructed here
 * rather than reused from those modules' own `create<X>Module()` factories —
 * those only return `Router`s, not the underlying service, and there's no
 * shared service registry in this codebase. The duplication is a few lines
 * of wiring per module, consistent with every module already being fully
 * self-contained.
 */
export const createDashboardModule = (): Router => {
  const users = new UserRepository();
  const kycService = new KycService(new KycRepository());
  const criminalRecordService = new CriminalRecordService(new CriminalRecordRepository());
  const subscriptionsService = new SubscriptionsService(
    new SubscriptionsRepository(),
    new RazorpayGateway()
  );
  const dashboardService = new DashboardService(
    users,
    kycService,
    criminalRecordService,
    subscriptionsService
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
   *       and subscription status into one response — everything a
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
