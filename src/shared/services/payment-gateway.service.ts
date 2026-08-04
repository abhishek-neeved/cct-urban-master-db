import Razorpay from 'razorpay';
import { createHmac } from 'crypto';
import { env } from '@config/env';

/**
 * Razorpay's own Payment Link lifecycle (see the `razorpay` SDK's
 * `PaymentLink['status']`). Owned here (not by `@modules/onboarding-fee`)
 * since it describes the gateway's model, not this app's domain —
 * `onboarding-fee.model.ts` imports it from here to store the raw status
 * verbatim, letting a replayed/out-of-order webhook always re-derive the
 * same client-facing status (see `toClientStatus`).
 */
export type RazorpayPaymentLinkStatus =
  'created' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';

export interface CreatedRazorpayPaymentLink {
  id: string;
  status: RazorpayPaymentLinkStatus;
  /** Client opens this to complete the one-time payment (new tab on web, in-app browser on mobile). */
  shortUrl: string;
}

export interface IPaymentGateway {
  /**
   * One-time payment via Razorpay's Payment Links API — no plan, no
   * recurring charge. `referenceId` (this app's onboarding-fee row id) is
   * echoed back on the `callback_url` and in the webhook payload, letting
   * both paths find the right row without depending on Razorpay's own id
   * being known ahead of creation.
   */
  createPaymentLink(input: {
    amountInRupees: number;
    referenceId: string;
    description: string;
    callbackUrl: string;
    customerEmail: string;
    customerName: string;
  }): Promise<CreatedRazorpayPaymentLink>;
  /** HMAC-SHA256 verification of `X-Razorpay-Signature` against the raw webhook body. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
  /**
   * HMAC-SHA256 verification of the `razorpay_signature` param Razorpay
   * appends to the payment link's callback redirect — a different secret
   * (the API key secret, not the webhook secret) and a different signed
   * string (`payment_link_id|payment_link_reference_id|payment_link_status|razorpay_payment_id`)
   * than the webhook's. Lets the callback route confirm payment
   * synchronously, without waiting on the webhook.
   */
  verifyPaymentLinkCallback(params: {
    paymentLinkId: string;
    paymentLinkReferenceId: string;
    paymentLinkStatus: string;
    paymentId: string;
    signature: string;
  }): boolean;
}

/**
 * Thin wrapper over the `razorpay` SDK. Kept behind `IPaymentGateway` (rather
 * than services importing the SDK directly) so `OnboardingFeeService` can be
 * unit-tested against a plain mock instead of a real/mocked Razorpay client.
 */
export class RazorpayGateway implements IPaymentGateway {
  private readonly client: Razorpay;

  constructor() {
    this.client = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }

  async createPaymentLink(input: {
    amountInRupees: number;
    referenceId: string;
    description: string;
    callbackUrl: string;
    customerEmail: string;
    customerName: string;
  }): Promise<CreatedRazorpayPaymentLink> {
    const link = await this.client.paymentLink.create({
      amount: input.amountInRupees * 100,
      currency: 'INR',
      description: input.description,
      reference_id: input.referenceId,
      callback_url: input.callbackUrl,
      callback_method: 'get',
      customer: { email: input.customerEmail, name: input.customerName },
    });
    return {
      id: link.id,
      status: link.status,
      shortUrl: link.short_url,
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return Razorpay.validateWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
  }

  verifyPaymentLinkCallback(params: {
    paymentLinkId: string;
    paymentLinkReferenceId: string;
    paymentLinkStatus: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const payload = `${params.paymentLinkId}|${params.paymentLinkReferenceId}|${params.paymentLinkStatus}|${params.paymentId}`;
    const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(payload).digest('hex');
    return expected === params.signature;
  }
}
