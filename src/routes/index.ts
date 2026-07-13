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
   *     summary: Liveness probe
   *     responses:
   *       200: { description: Process is up }
   */
  router.get('/health', health.live);

  /**
   * @openapi
   * /api/health/ready:
   *   get:
   *     tags: [Health]
   *     summary: Readiness probe (checks the database connection)
   *     responses:
   *       200: { description: Ready }
   *       503: { description: Not ready (database unavailable) }
   */
  router.get('/health/ready', health.ready);
  router.use('/', createDocsModule());
  router.use('/auth', createAuthModule());

  return router;
};
