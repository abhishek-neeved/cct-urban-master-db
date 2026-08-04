import { toClientStatus } from '@modules/onboarding-fee/onboarding-fee.types';

describe('toClientStatus', () => {
  it.each([
    ['created', 'unpaid'],
    ['partially_paid', 'unpaid'],
    ['paid', 'paid'],
    ['cancelled', 'unpaid'],
    ['expired', 'unpaid'],
  ] as const)(
    'maps Razorpay payment-link status "%s" to client status "%s"',
    (razorpayStatus, expected) => {
      expect(toClientStatus(razorpayStatus)).toBe(expected);
    }
  );
});
