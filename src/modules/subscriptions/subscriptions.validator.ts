import { z } from 'zod';

/**
 * Razorpay signs the webhook with `X-Razorpay-Signature`; the body itself has
 * no fixed shape this app needs to validate ahead of the signature check —
 * an unsigned/invalid body is rejected by signature verification in the
 * controller before this schema would ever matter. Kept permissive
 * (`z.record`) rather than modelling Razorpay's full payload shape, which
 * this app only reads a few fields from (see `SubscriptionsService.handleWebhookEvent`).
 */
export const webhookBodySchema = z.record(z.string(), z.unknown());
