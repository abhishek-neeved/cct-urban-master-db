import { Router } from 'express';
import { OnboardingFeeController } from './onboarding-fee.controller';
import { OnboardingFeeService } from './onboarding-fee.service';
import { OnboardingFeeRepository } from './onboarding-fee.repository';
import { RazorpayGateway } from '@shared/services/payment-gateway.service';
import { UserRepository } from '@modules/auth/user.repository';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { requireAbility } from '@middleware/require-ability';
import { callbackQuerySchema, checkoutSchema, webhookBodySchema } from './onboarding-fee.validator';

/**
 * Onboarding-fee feature module: a one-time ₹10 payment for the authenticated
 * user (only `service_provider` goes through this onboarding gate — see
 * `defineAbilitiesFor`), paid via a Razorpay Payment Link. Two independent
 * confirmation paths — the callback redirect and the webhook — both verified
 * by signature, neither routes requiring a user session (see
 * `onboarding-fee.service.ts`).
 */
export const createOnboardingFeeModule = (): Router => {
  const onboardingFees = new OnboardingFeeRepository();
  const users = new UserRepository();
  const gateway = new RazorpayGateway();
  const onboardingFeeService = new OnboardingFeeService(onboardingFees, users, gateway);
  const controller = new OnboardingFeeController(onboardingFeeService, gateway);
  const requireProvider = requireAbility(users, 'read', 'OnboardingFee');

  const router = Router();

  /**
   * @openapi
   * /api/onboarding-fee/me:
   *   get:
   *     tags: [OnboardingFee]
   *     summary: Get the authenticated user's onboarding-fee payment status
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/OnboardingFee' }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   */
  router.get('/me', requireAuth, requireProvider, controller.me);

  /**
   * @openapi
   * /api/onboarding-fee/checkout:
   *   post:
   *     tags: [OnboardingFee]
   *     summary: Start a one-time onboarding-fee payment
   *     description: >
   *       Creates a Razorpay Payment Link and returns the short URL the
   *       client opens (new tab on web, in-app browser on mobile) to pay.
   *       Status stays `unpaid` until the payment is confirmed via the
   *       callback redirect or the webhook — this endpoint never sets it
   *       directly.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/OnboardingFeeCheckoutRequest' }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/OnboardingFeeCheckoutResult' }
   *       401: { description: Missing/invalid access token }
   *       403: { description: Caller is not a service provider }
   *       409: { description: The onboarding fee has already been paid }
   */
  router.post(
    '/checkout',
    requireAuth,
    requireProvider,
    validate({ body: checkoutSchema }),
    controller.checkout
  );

  /**
   * @openapi
   * /api/onboarding-fee/callback:
   *   get:
   *     tags: [OnboardingFee]
   *     summary: Razorpay payment-link callback redirect
   *     description: >
   *       Not a user session request — Razorpay redirects the browser here
   *       after payment, with a signed set of query params. Verified via
   *       HMAC-SHA256 over those params (a different signature scheme than
   *       the webhook's). On success, redirects on to the `redirectUrl`
   *       supplied at checkout time.
   *     responses:
   *       302: { description: Redirects to redirectUrl once confirmed }
   *       400: { description: Payment was not completed, or no matching checkout found }
   *       401: { description: Invalid callback signature }
   */
  router.get('/callback', validate({ query: callbackQuerySchema }), controller.callback);

  /**
   * @openapi
   * /api/onboarding-fee/webhook:
   *   post:
   *     tags: [OnboardingFee]
   *     summary: Razorpay webhook — payment-link lifecycle events
   *     description: >
   *       Verified via the `X-Razorpay-Signature` header (HMAC-SHA256 over the
   *       raw request body), not a user session — a durable backup
   *       confirmation path alongside the callback redirect. Always returns
   *       200 for a recognised signature, even for events this app ignores,
   *       so Razorpay doesn't endlessly retry.
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
