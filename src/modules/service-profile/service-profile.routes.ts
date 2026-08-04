import { Router } from 'express';
import { ServiceProfileController } from './service-profile.controller';
import { ServiceProfileService } from './service-profile.service';
import { ServiceProfileRepository } from './service-profile.repository';
import { UserRepository } from '@modules/auth/user.repository';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { requireAbility } from '@middleware/require-ability';
import { upsertServiceProfileSchema } from './service-profile.validator';

/**
 * Service-profile feature module: what a service_provider offers — category,
 * description, years of experience — editable any time from the profile
 * page. `service_provider`-only, same as kyc/criminal-record/onboarding-fee.
 */
export const createServiceProfileModule = (): Router => {
  const serviceProfiles = new ServiceProfileRepository();
  const users = new UserRepository();
  const service = new ServiceProfileService(serviceProfiles, users);
  const controller = new ServiceProfileController(service);
  const requireProvider = requireAbility(users, 'read', 'Kyc');

  const router = Router();

  /**
   * @openapi
   * /api/service-profile/me:
   *   get:
   *     tags: [Service Profile]
   *     summary: Get the authenticated service provider's service profile
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK — `profile` is null if not set yet
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 profile:
   *                   nullable: true
   *                   allOf: [{ $ref: '#/components/schemas/ServiceProfile' }]
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   */
  router.get('/me', requireAuth, requireProvider, controller.me);

  /**
   * @openapi
   * /api/service-profile/me:
   *   put:
   *     tags: [Service Profile]
   *     summary: Set or update the authenticated service provider's service profile
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/UpsertServiceProfileRequest' }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 profile: { $ref: '#/components/schemas/ServiceProfile' }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   *       422: { description: Validation failed }
   */
  router.put(
    '/me',
    requireAuth,
    requireProvider,
    validate({ body: upsertServiceProfileSchema }),
    controller.upsert
  );

  return router;
};
