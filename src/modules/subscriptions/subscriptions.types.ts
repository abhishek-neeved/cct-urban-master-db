import type { RazorpaySubscriptionStatus, SubscriptionRow } from './subscriptions.model';

/**
 * Client-facing status — a coarser view of Razorpay's own lifecycle (see
 * `toClientStatus`). Mirrors mobile-app's `SubscriptionStatus` mock type
 * (`inactive` | `active`), extended with `past_due`/`cancelled` since a real
 * payment gateway has failure and cancellation states no mock ever needed.
 */
export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'cancelled';

export interface SubscriptionPlan {
  id: string;
  name: string;
  priceInRupees: number;
  intervalLabel: string;
}

/**
 * Domain representation returned to callers. Field names mirror mobile-app's
 * `Subscription` mock shape exactly (`status`, `plan`, `startedAt`,
 * `renewsAt`) — `razorpaySubscriptionId`/`razorpayStatus` are internal-only
 * and never appear here, by design (see `toSubscription`).
 */
export interface Subscription {
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  startedAt?: Date;
  renewsAt?: Date;
}

export const MONTHLY_PLAN: SubscriptionPlan = {
  id: 'monthly',
  name: 'Monthly plan',
  priceInRupees: 10,
  intervalLabel: 'month',
};

export const INACTIVE_SUBSCRIPTION: Subscription = { status: 'inactive', plan: MONTHLY_PLAN };

/**
 * Razorpay's 8 lifecycle states collapse to the 4 states a client actually
 * needs to render differently. `created`/`authenticated`/`pending` are
 * mid-checkout states with no completed payment yet — the client already
 * shows `inactive` (no subscription record exists) during that window, so
 * they map there too rather than needing a fifth "pending" UI state.
 */
export const toClientStatus = (status: RazorpaySubscriptionStatus): SubscriptionStatus => {
  switch (status) {
    case 'active':
    case 'completed':
      return 'active';
    case 'halted':
      return 'past_due';
    case 'cancelled':
    case 'expired':
      return 'cancelled';
    case 'created':
    case 'authenticated':
    case 'pending':
      return 'inactive';
  }
};

export const toSubscription = (row: SubscriptionRow): Subscription => ({
  status: toClientStatus(row.razorpayStatus),
  plan: MONTHLY_PLAN,
  startedAt: row.startedAt ?? undefined,
  renewsAt: row.renewsAt ?? undefined,
});
