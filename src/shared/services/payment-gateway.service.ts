import Razorpay from 'razorpay';
import { env } from '@config/env';

/**
 * Razorpay's own subscription lifecycle (see the `razorpay` SDK's
 * `Subscriptions.RazorpaySubscription['status']`). Owned here (not by
 * `@modules/subscriptions`) since it describes the gateway's model, not this
 * app's domain — `subscriptions.model.ts` imports it from here to store the
 * raw status verbatim, letting a replayed/out-of-order webhook always
 * re-derive the same client-facing status (see `toClientStatus`).
 */
export type RazorpaySubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'cancelled'
  | 'completed'
  | 'expired';

export interface CreatedRazorpaySubscription {
  id: string;
  status: RazorpaySubscriptionStatus;
  /** Client SDK (Razorpay Checkout) opens with this id to collect the authorization payment. */
  shortUrl: string;
}

export interface IPaymentGateway {
  createSubscription(planId: string): Promise<CreatedRazorpaySubscription>;
  cancelSubscription(razorpaySubscriptionId: string, cancelAtCycleEnd: boolean): Promise<void>;
  /** HMAC-SHA256 verification of `X-Razorpay-Signature` against the raw webhook body. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

/**
 * Thin wrapper over the `razorpay` SDK. Kept behind `IPaymentGateway` (rather
 * than services importing the SDK directly) so `SubscriptionsService` can be
 * unit-tested against a plain mock instead of a real/mocked Razorpay client.
 */
export class RazorpayGateway implements IPaymentGateway {
  private readonly client: Razorpay;

  constructor() {
    this.client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }

  async createSubscription(planId: string): Promise<CreatedRazorpaySubscription> {
    // total_count: 120 monthly cycles (10 years) — Razorpay requires a finite
    // count; there is no "forever" option, so this is treated as "renews
    // until cancelled" for all practical purposes.
    const subscription = await this.client.subscriptions.create({
      plan_id: planId,
      total_count: 120,
    });
    return {
      id: subscription.id,
      status: subscription.status,
      shortUrl: subscription.short_url,
    };
  }

  async cancelSubscription(razorpaySubscriptionId: string, cancelAtCycleEnd: boolean): Promise<void> {
    await this.client.subscriptions.cancel(razorpaySubscriptionId, cancelAtCycleEnd);
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return Razorpay.validateWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
  }
}
