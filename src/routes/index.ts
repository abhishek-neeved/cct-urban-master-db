import { Router } from 'express';
import { HealthController } from '@modules/health/health.controller';
import { createAuthModule } from '@modules/auth/auth.routes';
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

  return router;
};
