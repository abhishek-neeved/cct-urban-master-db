import { Router } from 'express';
import { HealthController } from '@modules/health/health.controller';
import { createAuthModule } from '@modules/auth/auth.routes';
import { createUsersModule } from '@modules/users/users.routes';
import { createUploadsModule } from '@modules/uploads/uploads.routes';
import { createKycModule } from '@modules/kyc/kyc.routes';
import { createCriminalRecordModule } from '@modules/criminal-record/criminal-record.routes';
import { createSubscriptionsModule } from '@modules/subscriptions/subscriptions.routes';
import { createDashboardModule } from '@modules/dashboard/dashboard.routes';
import { createDocsModule } from '@modules/docs/docs.routes';

/**
 * Top-level API router — a thin mount table. Each feature module wires its own
 * dependencies and exposes a router; this file only decides where they mount.
 * Add a feature by writing its `createXModule()` and adding one line here.
 */
export const createApiRouter = (): Router => {
  const router = Router();
  const health = new HealthController();

  /**
   * @openapi
   * /api/health:
   *   get:
   *     tags: [Health]
   *     summary: Health probe (liveness + readiness combined)
   *     description: "Returns `ok: 1` when the process is up and MongoDB is reachable, otherwise `ok: -1`."
   *     responses:
   *       200: { description: Healthy (ok = 1) }
   *       503: { description: Unhealthy — database unavailable (ok = -1) }
   */
  router.get('/health', health.check);
  router.use('/', createDocsModule());
  router.use('/auth', createAuthModule());
  router.use('/users', createUsersModule());
  router.use('/uploads', createUploadsModule());

  const { userRouter: kycRouter, adminRouter: adminKycRouter } = createKycModule();
  router.use('/kyc', kycRouter);
  router.use('/admin/kyc', adminKycRouter);

  const { userRouter: criminalRecordRouter, adminRouter: adminCriminalRecordRouter } =
    createCriminalRecordModule();
  router.use('/criminal-record', criminalRecordRouter);
  router.use('/admin/criminal-record', adminCriminalRecordRouter);

  router.use('/subscriptions', createSubscriptionsModule());

  router.use('/dashboard', createDashboardModule());

  return router;
};
