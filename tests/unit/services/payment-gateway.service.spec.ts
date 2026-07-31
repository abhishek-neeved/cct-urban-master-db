import { vi } from 'vitest';

const subscriptionsCreateMock = vi.fn();
const subscriptionsCancelMock = vi.fn();
const validateWebhookSignatureMock = vi.fn();

vi.mock('razorpay', () => {
  const RazorpayMock = vi.fn().mockImplementation(function RazorpayMock() {
    return {
      subscriptions: {
        create: subscriptionsCreateMock,
        cancel: subscriptionsCancelMock,
      },
    };
  });
  // Razorpay's real SDK exposes `validateWebhookSignature` as a static on the
  // class (`export = Razorpay` with `static validateWebhookSignature`), not
  // an instance method — mirror that shape exactly.
  (RazorpayMock as unknown as { validateWebhookSignature: typeof validateWebhookSignatureMock }).validateWebhookSignature =
    validateWebhookSignatureMock;
  return { default: RazorpayMock };
});

const { RazorpayGateway } = await import('@shared/services/payment-gateway.service');

describe('RazorpayGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSubscription', () => {
    it('creates a subscription for the given plan with a 120-cycle total_count', async () => {
      subscriptionsCreateMock.mockResolvedValue({
        id: 'sub_1',
        status: 'created',
        short_url: 'https://rzp.io/i/abc',
      });
      const gateway = new RazorpayGateway();

      const result = await gateway.createSubscription('plan_123');

      expect(subscriptionsCreateMock).toHaveBeenCalledWith({ plan_id: 'plan_123', total_count: 120 });
      expect(result).toEqual({ id: 'sub_1', status: 'created', shortUrl: 'https://rzp.io/i/abc' });
    });
  });

  describe('cancelSubscription', () => {
    it('cancels immediately when cancelAtCycleEnd is false', async () => {
      subscriptionsCancelMock.mockResolvedValue({});
      const gateway = new RazorpayGateway();

      await gateway.cancelSubscription('sub_1', false);

      expect(subscriptionsCancelMock).toHaveBeenCalledWith('sub_1', false);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('delegates to the static Razorpay.validateWebhookSignature with the configured secret', () => {
      validateWebhookSignatureMock.mockReturnValue(true);
      const gateway = new RazorpayGateway();

      const result = gateway.verifyWebhookSignature('{"event":"x"}', 'sig123');

      expect(validateWebhookSignatureMock).toHaveBeenCalledWith(
        '{"event":"x"}',
        'sig123',
        'dev-webhook-secret-change-me'
      );
      expect(result).toBe(true);
    });

    it('returns false for an invalid signature', () => {
      validateWebhookSignatureMock.mockReturnValue(false);
      const gateway = new RazorpayGateway();

      expect(gateway.verifyWebhookSignature('{"event":"x"}', 'wrong-sig')).toBe(false);
    });
  });
});
