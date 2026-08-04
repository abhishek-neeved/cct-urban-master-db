import type { IOnboardingFeeRepository } from './onboarding-fee.repository';
import {
  OnboardingFee,
  ONBOARDING_FEE_AMOUNT_INR,
  UNPAID_ONBOARDING_FEE,
} from './onboarding-fee.types';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { IPaymentGateway } from '@shared/services/payment-gateway.service';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';
import { logger } from '@utils/logger';

export interface CheckoutResult {
  /** Client opens this to complete the one-time payment (new tab on web, in-app browser on mobile). */
  shortUrl: string;
}

/** The subset of Razorpay's payment-link webhook payload this app reads. */
export interface RazorpayPaymentLinkWebhookPayload {
  event: string;
  payload: {
    payment_link: {
      entity: {
        id: string;
        status: 'created' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';
      };
    };
  };
}

/**
 * One-time onboarding-fee checkout + confirmation. Business logic only — no
 * HTTP, no mongoose, no Razorpay SDK types beyond `IPaymentGateway`'s.
 *
 * Status is set from two independent, equally-trusted paths: the callback
 * redirect (`confirmCallback`, verified via HMAC of the redirect params) and
 * the webhook (`handleWebhookEvent`, verified via `X-Razorpay-Signature`).
 * Whichever arrives first marks the row paid; the other is then a no-op.
 * Neither trusts the client's own claim that payment succeeded — both
 * require a Razorpay-signed confirmation.
 */
export class OnboardingFeeService {
  constructor(
    private readonly onboardingFees: IOnboardingFeeRepository,
    private readonly users: IUserRepository,
    private readonly gateway: IPaymentGateway
  ) {}

  async getStatus(userId: string): Promise<OnboardingFee> {
    const fee = await this.onboardingFees.findByUserId(userId);
    return fee ?? UNPAID_ONBOARDING_FEE;
  }

  /**
   * Creates a fresh Razorpay payment link. A prior `created`/`cancelled`/
   * `expired` row (never paid) is cleared first so the unique
   * `razorpayPaymentLinkId` constraint doesn't block a retry — paid is the
   * only status that blocks a new checkout.
   *
   * `referenceId` is `userId` plus a per-attempt nonce, not just `userId` —
   * Razorpay enforces `reference_id` uniqueness permanently across the whole
   * account (it refuses a reused value even after the earlier link expired
   * or was abandoned), so a bare `userId` would only ever work once per user
   * for the account's entire lifetime.
   */
  async checkout(userId: string, callbackUrl: string): Promise<CheckoutResult> {
    const existing = await this.onboardingFees.findByUserId(userId);
    if (existing?.status === 'paid') {
      throw new ConflictError('The onboarding fee has already been paid');
    }
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }
    if (existing) {
      await this.onboardingFees.deleteByUserId(userId);
    }

    const link = await this.gateway.createPaymentLink({
      amountInRupees: ONBOARDING_FEE_AMOUNT_INR,
      referenceId: `${userId}-${Date.now()}`,
      description: 'CoinCircleTrust onboarding fee',
      callbackUrl,
      customerEmail: user.email,
      customerName: `${user.firstName} ${user.lastName}`,
    });
    await this.onboardingFees.create({
      userId,
      razorpayPaymentLinkId: link.id,
      status: link.status,
    });
    logger.info('Onboarding-fee checkout started', { userId, razorpayPaymentLinkId: link.id });
    return { shortUrl: link.shortUrl };
  }

  /**
   * Confirms payment from the callback redirect Razorpay appends after the
   * user pays. `paymentLinkReferenceId` is this app's `userId` (set as
   * `reference_id` at checkout) — used only to look up the right row; the
   * signature (verified by the caller before this runs) is what actually
   * proves the payment happened, not the presence of a matching row.
   */
  async confirmCallback(paymentLinkId: string): Promise<void> {
    const updated = await this.onboardingFees.applyPaymentUpdate(paymentLinkId, {
      status: 'paid',
      paidAt: new Date(),
    });
    if (!updated) {
      throw new BadRequestError('No matching onboarding-fee checkout found');
    }
    logger.info('Onboarding fee confirmed via callback', { razorpayPaymentLinkId: paymentLinkId });
  }

  /**
   * Verify and apply a Razorpay payment-link webhook. Idempotent: applying
   * the same event twice (Razorpay's documented at-least-once delivery) just
   * re-applies the same status, a no-op the second time. Unknown payment
   * link ids (e.g. a webhook for a different Razorpay account) are logged
   * and ignored rather than treated as errors — Razorpay expects a 200
   * either way, or it keeps retrying.
   */
  async handleWebhookEvent(payload: RazorpayPaymentLinkWebhookPayload): Promise<void> {
    const entity = payload.payload.payment_link?.entity;
    if (!entity) {
      logger.warn('Razorpay webhook missing payment_link entity — ignored', {
        event: payload.event,
      });
      return;
    }

    const updated = await this.onboardingFees.applyPaymentUpdate(entity.id, {
      status: entity.status,
      paidAt: entity.status === 'paid' ? new Date() : undefined,
    });

    if (!updated) {
      logger.warn('Razorpay webhook for unknown payment link — ignored', {
        razorpayPaymentLinkId: entity.id,
        event: payload.event,
      });
      return;
    }

    logger.info('Razorpay webhook applied', {
      razorpayPaymentLinkId: entity.id,
      event: payload.event,
      status: entity.status,
    });
  }
}
