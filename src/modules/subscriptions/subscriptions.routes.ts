import { Router } from 'express';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { RazorpayGateway } from '@shared/services/payment-gateway.service';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { webhookBodySchema } from './subscriptions.validator';

/**
 * Subscriptions feature module: checkout/status/cancel for the authenticated
 * user, plus the Razorpay webhook that's the only place status actually
 * changes (see subscriptions.service.ts). The webhook route has no
 * `requireAuth` — its trust boundary is the signature check in the
 * controller, not a user session.
 */
export const createSubscriptionsModule = (): Router => {
  const subscriptions = new SubscriptionsRepository();
  const gateway = new RazorpayGateway();
  const subscriptionsService = new SubscriptionsService(subscriptions, gateway);
  const controller = new SubscriptionsController(subscriptionsService, gateway);

  const router = Router();

  /**
   * @openapi
   * /api/subscriptions/me:
   *   get:
   *     tags: [Subscriptions]
   *     summary: Get the authenticated user's subscription status
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Subscription' }
   *       401: { description: Missing/invalid access token }
   */
  router.get('/me', requireAuth, controller.me);

  /**
   * @openapi
   * /api/subscriptions/checkout:
   *   post:
   *     tags: [Subscriptions]
   *     summary: Start a new subscription checkout
   *     description: >
   *       Creates a Razorpay subscription and returns the id + short URL the
   *       client opens (Razorpay Checkout) to collect the authorization
   *       payment. Status stays `inactive` until Razorpay's webhook confirms
   *       the payment succeeded — this endpoint never sets it directly.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/CheckoutResult' }
   *       401: { description: Missing/invalid access token }
   *       409: { description: Already has an active subscription }
   */
  router.post('/checkout', requireAuth, controller.checkout);

  /**
   * @openapi
   * /api/subscriptions/cancel:
   *   post:
   *     tags: [Subscriptions]
   *     summary: Cancel the authenticated user's active subscription
   *     description: Cancels immediately via the Razorpay API (not at cycle end).
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string, example: 'Subscription cancelled' }
   *       400: { description: No active subscription to cancel }
   *       401: { description: Missing/invalid access token }
   */
  router.post('/cancel', requireAuth, controller.cancel);

  /**
   * @openapi
   * /api/subscriptions/webhook:
   *   post:
   *     tags: [Subscriptions]
   *     summary: Razorpay webhook — subscription lifecycle events
   *     description: >
   *       Verified via the `X-Razorpay-Signature` header (HMAC-SHA256 over the
   *       raw request body), not a user session — this is the only endpoint
   *       allowed to change subscription status. Always returns 200 for a
   *       recognised signature, even for events this app ignores, so Razorpay
   *       doesn't endlessly retry.
   *     parameters:
   *       - in: header
   *         name: X-Razorpay-Signature
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: OK — event applied or ignored }
   *       401: { description: Invalid or missing webhook signature }
   */
  router.post('/webhook', validate({ body: webhookBodySchema }), controller.webhook);

  return router;
};
