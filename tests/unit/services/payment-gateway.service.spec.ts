import { vi } from 'vitest';
import { createHmac } from 'crypto';

const paymentLinkCreateMock = vi.fn();
const validateWebhookSignatureMock = vi.fn();

vi.mock('razorpay', () => {
  const RazorpayMock = vi.fn().mockImplementation(function RazorpayMock() {
    return {
      paymentLink: {
        create: paymentLinkCreateMock,
      },
    };
  });
  // Razorpay's real SDK exposes `validateWebhookSignature` as a static on the
  // class (`export = Razorpay` with `static validateWebhookSignature`), not
  // an instance method — mirror that shape exactly.
  (
    RazorpayMock as unknown as { validateWebhookSignature: typeof validateWebhookSignatureMock }
  ).validateWebhookSignature = validateWebhookSignatureMock;
  return { default: RazorpayMock };
});

const { RazorpayGateway } = await import('@shared/services/payment-gateway.service');

describe('RazorpayGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPaymentLink', () => {
    it('creates a payment link, converting rupees to paise and mapping the response', async () => {
      paymentLinkCreateMock.mockResolvedValue({
        id: 'plink_1',
        status: 'created',
        short_url: 'https://rzp.io/i/abc',
      });
      const gateway = new RazorpayGateway();

      const result = await gateway.createPaymentLink({
        amountInRupees: 10,
        referenceId: 'u1',
        description: 'CoinCircleTrust onboarding fee',
        callbackUrl: 'https://app.example.com/api/onboarding-fee/callback',
        customerEmail: 'ada@example.com',
        customerName: 'Ada Lovelace',
      });

      expect(paymentLinkCreateMock).toHaveBeenCalledWith({
        amount: 1000,
        currency: 'INR',
        description: 'CoinCircleTrust onboarding fee',
        reference_id: 'u1',
        callback_url: 'https://app.example.com/api/onboarding-fee/callback',
        callback_method: 'get',
        customer: { email: 'ada@example.com', name: 'Ada Lovelace' },
      });
      expect(result).toEqual({
        id: 'plink_1',
        status: 'created',
        shortUrl: 'https://rzp.io/i/abc',
      });
    });
  });

  describe('verifyWebhookSignature', () => {
    it('delegates to the static Razorpay.validateWebhookSignature with the configured webhook secret', () => {
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

  describe('verifyPaymentLinkCallback', () => {
    // A pure local HMAC computation (no network call, no mocked Razorpay
    // method involved) — computed the same way the gateway itself does, using
    // the configured Razorpay *key secret* (not the webhook secret; a
    // different secret is used for this check, see payment-gateway.service.ts).
    const KEY_SECRET = 'dev-razorpay-secret-change-me';
    const sign = (
      paymentLinkId: string,
      paymentLinkReferenceId: string,
      paymentLinkStatus: string,
      paymentId: string
    ) =>
      createHmac('sha256', KEY_SECRET)
        .update(`${paymentLinkId}|${paymentLinkReferenceId}|${paymentLinkStatus}|${paymentId}`)
        .digest('hex');

    it('returns true for a validly signed set of callback params', () => {
      const gateway = new RazorpayGateway();
      const signature = sign('plink_1', 'u1', 'paid', 'pay_1');

      const result = gateway.verifyPaymentLinkCallback({
        paymentLinkId: 'plink_1',
        paymentLinkReferenceId: 'u1',
        paymentLinkStatus: 'paid',
        paymentId: 'pay_1',
        signature,
      });

      expect(result).toBe(true);
    });

    it('returns false when the signature does not match the computed HMAC', () => {
      const gateway = new RazorpayGateway();

      const result = gateway.verifyPaymentLinkCallback({
        paymentLinkId: 'plink_1',
        paymentLinkReferenceId: 'u1',
        paymentLinkStatus: 'paid',
        paymentId: 'pay_1',
        signature: 'not-the-real-signature',
      });

      expect(result).toBe(false);
    });

    it('returns false when any signed field changes (signature was computed for different params)', () => {
      const gateway = new RazorpayGateway();
      const signature = sign('plink_1', 'u1', 'paid', 'pay_1');

      const result = gateway.verifyPaymentLinkCallback({
        paymentLinkId: 'plink_1',
        paymentLinkReferenceId: 'u1',
        paymentLinkStatus: 'cancelled', // tampered status, signature no longer matches
        paymentId: 'pay_1',
        signature,
      });

      expect(result).toBe(false);
    });
  });
});
