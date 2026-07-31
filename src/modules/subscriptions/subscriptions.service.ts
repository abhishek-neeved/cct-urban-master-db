import type { ISubscriptionsRepository } from './subscriptions.repository';
import { INACTIVE_SUBSCRIPTION, Subscription, toSubscription } from './subscriptions.types';
import type { IPaymentGateway, RazorpaySubscriptionStatus } from '@shared/services/payment-gateway.service';
import { env } from '@config/env';
import { BadRequestError, ConflictError } from '@utils/errors';
import { logger } from '@utils/logger';

export interface CheckoutResult {
  /** Razorpay Checkout opens with this to collect the authorization payment. */
  razorpaySubscriptionId: string;
  shortUrl: string;
}

/** The subset of Razorpay's subscription webhook payload this app reads. */
export interface RazorpaySubscriptionWebhookPayload {
  event: string;
  payload: {
    subscription: {
      entity: {
        id: string;
        status: RazorpaySubscriptionStatus;
        current_start?: number | null;
        current_end?: number | null;
        ended_at?: number | null;
      };
    };
  };
}

/**
 * Subscription checkout + Razorpay webhook processing. Business logic only —
 * no HTTP, no mongoose, no Razorpay SDK types beyond `IPaymentGateway`'s.
 *
 * Status is never set directly by `checkout()` — only `handleWebhookEvent`,
 * called from a signature-verified webhook, is allowed to transition it. A
 * client claiming "payment succeeded" is not itself proof of payment; only
 * Razorpay's own signed notification is.
 */
export class SubscriptionsService {
  constructor(
    private readonly subscriptions: ISubscriptionsRepository,
    private readonly gateway: IPaymentGateway
  ) {}

  async getStatus(userId: string): Promise<Subscription> {
    const subscription = await this.subscriptions.findByUserId(userId);
    return subscription ?? INACTIVE_SUBSCRIPTION;
  }

  async checkout(userId: string): Promise<CheckoutResult> {
    const existing = await this.subscriptions.findByUserId(userId);
    if (existing?.status === 'active') {
      throw new ConflictError('You already have an active subscription');
    }
    const created = await this.gateway.createSubscription(env.RAZORPAY_PLAN_ID);
    await this.subscriptions.create({
      userId,
      razorpaySubscriptionId: created.id,
      razorpayStatus: created.status,
    });
    logger.info('Subscription checkout started', { userId, razorpaySubscriptionId: created.id });
    return { razorpaySubscriptionId: created.id, shortUrl: created.shortUrl };
  }

  async cancel(userId: string): Promise<void> {
    // The row (not the domain type) is needed here — only it carries
    // razorpaySubscriptionId, which `toSubscription` deliberately omits from
    // what's returned to callers.
    const row = await this.subscriptions.findRowByUserId(userId);
    if (!row || toSubscription(row).status !== 'active') {
      throw new BadRequestError('You do not have an active subscription to cancel');
    }
    await this.gateway.cancelSubscription(row.razorpaySubscriptionId, false);
    logger.info('Subscription cancellation requested', {
      userId,
      razorpaySubscriptionId: row.razorpaySubscriptionId,
    });
  }

  /**
   * Verify and apply a Razorpay webhook. Idempotent: applying the same event
   * twice (Razorpay's documented at-least-once delivery) just re-applies the
   * same status/timestamps, which is a no-op the second time. Unknown
   * subscription ids (e.g. a webhook for a different Razorpay account) and
   * unrecognised events are logged and ignored rather than treated as errors
   * — Razorpay expects a 200 either way, or it keeps retrying.
   */
  async handleWebhookEvent(payload: RazorpaySubscriptionWebhookPayload): Promise<void> {
    const entity = payload.payload.subscription?.entity;
    if (!entity) {
      logger.warn('Razorpay webhook missing subscription entity — ignored', {
        event: payload.event,
      });
      return;
    }

    const updated = await this.subscriptions.applyWebhookUpdate(entity.id, {
      razorpayStatus: entity.status,
      startedAt: entity.current_start ? new Date(entity.current_start * 1000) : undefined,
      renewsAt: entity.current_end ? new Date(entity.current_end * 1000) : undefined,
      cancelledAt: entity.ended_at ? new Date(entity.ended_at * 1000) : undefined,
    });

    if (!updated) {
      logger.warn('Razorpay webhook for unknown subscription — ignored', {
        razorpaySubscriptionId: entity.id,
        event: payload.event,
      });
      return;
    }

    logger.info('Razorpay webhook applied', {
      razorpaySubscriptionId: entity.id,
      event: payload.event,
      status: entity.status,
    });
  }
}
