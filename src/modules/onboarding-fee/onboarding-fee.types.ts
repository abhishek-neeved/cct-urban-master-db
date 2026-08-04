import type { OnboardingFeeRow, RazorpayPaymentLinkStatus } from './onboarding-fee.model';

/**
 * Client-facing status — a coarser view of Razorpay's payment-link lifecycle
 * (see `toClientStatus`). Once paid, this is permanent: there is no
 * repayment, cancellation, or expiry for an account that has already paid —
 * a one-time fee, paid once, ever.
 */
export type OnboardingFeeStatus = 'unpaid' | 'paid';

export const ONBOARDING_FEE_AMOUNT_INR = 10;

/**
 * Domain representation returned to callers. `razorpayPaymentLinkId` is
 * internal-only and never appears here, by design (see `toOnboardingFee`).
 */
export interface OnboardingFee {
  status: OnboardingFeeStatus;
  amountInRupees: number;
  paidAt?: Date;
}

export const UNPAID_ONBOARDING_FEE: OnboardingFee = {
  status: 'unpaid',
  amountInRupees: ONBOARDING_FEE_AMOUNT_INR,
};

/**
 * Razorpay's 5 payment-link states collapse to the 2 states a client needs.
 * `created`/`partially_paid` are mid-checkout states with no completed
 * payment yet — the client already shows `unpaid` (no row exists) during
 * that window. `cancelled`/`expired` also collapse to `unpaid` — the fee is
 * still owed, and a fresh checkout is allowed to create a new payment link.
 */
export const toClientStatus = (status: RazorpayPaymentLinkStatus): OnboardingFeeStatus => {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'created':
    case 'partially_paid':
    case 'cancelled':
    case 'expired':
      return 'unpaid';
  }
};

export const toOnboardingFee = (row: OnboardingFeeRow): OnboardingFee => ({
  status: toClientStatus(row.status),
  amountInRupees: ONBOARDING_FEE_AMOUNT_INR,
  paidAt: row.paidAt ?? undefined,
});
