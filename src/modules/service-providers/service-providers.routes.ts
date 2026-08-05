import { Router } from 'express';
import { ServiceProvidersController } from './service-providers.controller';
import { ServiceProvidersService } from './service-providers.service';
import { UserRepository } from '@modules/auth/user.repository';
import { KycRepository } from '@modules/kyc/kyc.repository';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { requireAbility } from '@middleware/require-ability';
import { listServiceProvidersQuerySchema } from './service-providers.validator';

/**
 * Service-providers feature module: the customer-facing directory under
 * `/api/service-providers` — how a customer finds someone to book. Read-only
 * composition over `auth` + `kyc`, so it owns no model of its own.
 */
export const createServiceProvidersModule = (): Router => {
  const users = new UserRepository();
  const kyc = new KycRepository();
  const service = new ServiceProvidersService(users, kyc);
  const controller = new ServiceProvidersController(service);
  const requireDirectoryAccess = requireAbility(users, 'read', 'ServiceProviderDirectory');

  const router = Router();

  /**
   * @openapi
   * /api/service-providers:
   *   get:
   *     tags: [Service Providers]
   *     summary: List KYC-verified service providers (customer/admin only)
   *     description: >
   *       Only providers whose KYC status is "verified" appear here — an
   *       unverified or still-onboarding service_provider is never
   *       customer-facing. Contact is by phone; there's no in-app messaging.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: category
   *         required: false
   *         schema: { type: string, enum: [electrician, plumber, cleaner, carpenter, painter, other] }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 providers:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/ServiceProviderListing' }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is a service provider (directory is customer/admin only) }
   *       422: { description: Validation failed }
   */
  router.get(
    '/',
    requireAuth,
    requireDirectoryAccess,
    validate({ query: listServiceProvidersQuerySchema }),
    controller.list
  );

  return router;
};
