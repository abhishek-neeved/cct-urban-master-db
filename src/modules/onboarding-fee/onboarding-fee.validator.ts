import { z } from 'zod';

export const checkoutSchema = z.object({
  /** Where the client wants to land after paying — the callback route redirects here once confirmed. */
  redirectUrl: z.string().url(),
});

/**
 * Query params Razorpay appends to the payment link's `callback_url`
 * redirect. Signature is verified separately (see
 * `payment-gateway.service.ts`'s `verifyPaymentLinkCallback`) — this schema
 * only enforces the shape, not trust.
 */
export const callbackQuerySchema = z.object({
  razorpay_payment_id: z.string().min(1),
  razorpay_payment_link_id: z.string().min(1),
  razorpay_payment_link_reference_id: z.string().min(1),
  razorpay_payment_link_status: z.string().min(1),
  razorpay_signature: z.string().min(1),
  redirectUrl: z.string().url(),
});

/**
 * Razorpay signs the webhook with `X-Razorpay-Signature`; the body itself has
 * no fixed shape this app needs to validate ahead of the signature check —
 * an unsigned/invalid body is rejected by signature verification in the
 * controller before this schema would ever matter. Kept permissive
 * (`z.record`) rather than modelling Razorpay's full payload shape, which
 * this app only reads a few fields from (see `OnboardingFeeService.handleWebhookEvent`).
 */
export const webhookBodySchema = z.record(z.string(), z.unknown());
