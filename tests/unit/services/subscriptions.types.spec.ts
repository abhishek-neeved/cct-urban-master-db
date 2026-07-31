import { toClientStatus } from '@modules/subscriptions/subscriptions.types';

describe('toClientStatus', () => {
  it.each([
    ['created', 'inactive'],
    ['authenticated', 'inactive'],
    ['pending', 'inactive'],
    ['active', 'active'],
    ['completed', 'active'],
    ['halted', 'past_due'],
    ['cancelled', 'cancelled'],
    ['expired', 'cancelled'],
  ] as const)('maps Razorpay status "%s" to client status "%s"', (razorpayStatus, expected) => {
    expect(toClientStatus(razorpayStatus)).toBe(expected);
  });
});
