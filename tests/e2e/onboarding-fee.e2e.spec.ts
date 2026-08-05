import crypto from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import type { Application } from 'express';
import { UserModel } from '@modules/auth/auth.model';

// Real Razorpay API calls (paymentLink.create) are mocked; both signature
// checks are NOT mocked — verifyWebhookSignature/verifyPaymentLinkCallback
// are pure local HMAC computations (no network call), so these tests compute
// real, verifiable signatures the same way Razorpay itself would.
const paymentLinkCreateMock = vi.fn();

vi.mock('razorpay', async () => {
  const actual = await vi.importActual<{ default: unknown }>('razorpay');
  const RazorpayMock = vi.fn().mockImplementation(function RazorpayMock() {
    return {
      paymentLink: { create: paymentLinkCreateMock },
    };
  });
  (RazorpayMock as unknown as { validateWebhookSignature: unknown }).validateWebhookSignature = (
    actual.default as { validateWebhookSignature: unknown }
  ).validateWebhookSignature;
  return { default: RazorpayMock };
});

const { createApp } = await import('@/app');
const { connectTestDb, clearTestDb, closeTestDb } = await import('../helpers/db');

const WEBHOOK_SECRET = 'dev-webhook-secret-change-me';
const KEY_SECRET = 'dev-razorpay-secret-change-me';
const REDIRECT_URL = 'https://app.example.com/onboarding/done';

const signWebhookBody = (body: unknown): { raw: string; signature: string } => {
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  return { raw, signature };
};

const paidWebhookPayload = (razorpayPaymentLinkId: string) => ({
  event: 'payment_link.paid',
  payload: {
    payment_link: {
      entity: {
        id: razorpayPaymentLinkId,
        status: 'paid',
      },
    },
  },
});

const signCallbackParams = (params: {
  paymentLinkId: string;
  paymentLinkReferenceId: string;
  paymentLinkStatus: string;
  paymentId: string;
}): string =>
  crypto
    .createHmac('sha256', KEY_SECRET)
    .update(
      `${params.paymentLinkId}|${params.paymentLinkReferenceId}|${params.paymentLinkStatus}|${params.paymentId}`
    )
    .digest('hex');

describe('Onboarding-fee API (e2e)', () => {
  let app: Application;

  beforeAll(async () => {
    await connectTestDb();
    app = createApp();
  });
  afterEach(clearTestDb);
  afterAll(closeTestDb);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Every self-registered account is a service_provider — there is no
  // account-type choice at signup anymore.
  const registerAndLogin = async (
    email: string
  ): Promise<{ accessToken: string; userId: string }> => {
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ firstName: 'Test', lastName: 'User', email, password: 'supersecret' });
    const otp = registerRes.body.data.otpDevCode as string;
    await request(app).post('/api/auth/verify-otp').send({ email, otp }).expect(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'supersecret' });
    const accessToken = loginRes.body.data.accessToken as string;
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    return { accessToken, userId: me.body.data.user.id as string };
  };

  const registerAsCustomer = async (email: string): Promise<string> => {
    const { accessToken } = await registerAndLogin(email);
    await UserModel.updateOne({ email }, { role: 'customer' });
    return accessToken;
  };

  describe('GET /api/onboarding-fee/me', () => {
    it('returns "unpaid" before any checkout', async () => {
      const { accessToken } = await registerAndLogin('ob1@example.com');

      const res = await request(app)
        .get('/api/onboarding-fee/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ status: 'unpaid', amountInRupees: 10 });
    });

    it('rejects without a valid access token', async () => {
      await request(app).get('/api/onboarding-fee/me').expect(401);
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAsCustomer('ob-customer1@example.com');

      const res = await request(app)
        .get('/api/onboarding-fee/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/onboarding-fee/checkout', () => {
    it('starts checkout and returns the Razorpay short URL, still unpaid until confirmed', async () => {
      const { accessToken } = await registerAndLogin('ob2@example.com');
      paymentLinkCreateMock.mockResolvedValue({
        id: 'plink_1',
        status: 'created',
        short_url: 'https://rzp.io/i/abc',
      });

      const res = await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: REDIRECT_URL });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ shortUrl: 'https://rzp.io/i/abc' });
      expect(paymentLinkCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          currency: 'INR',
          callback_url: expect.stringContaining('/api/onboarding-fee/callback?redirectUrl='),
        })
      );

      const status = await request(app)
        .get('/api/onboarding-fee/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(status.body.data).toEqual({ status: 'unpaid', amountInRupees: 10 }); // not paid until confirmed
    });

    it('rejects starting a second checkout once already paid, with 409', async () => {
      const { accessToken } = await registerAndLogin('ob3@example.com');
      paymentLinkCreateMock.mockResolvedValue({
        id: 'plink_2',
        status: 'created',
        short_url: 'https://rzp.io/i/def',
      });
      await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: REDIRECT_URL });
      const { raw, signature } = signWebhookBody(paidWebhookPayload('plink_2'));
      await request(app)
        .post('/api/onboarding-fee/webhook')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(raw);

      const res = await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: REDIRECT_URL });

      expect(res.status).toBe(409);
    });

    it('rejects an invalid redirectUrl with a validation error', async () => {
      const { accessToken } = await registerAndLogin('ob-badredirect@example.com');

      const res = await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: 'not-a-url' });

      expect(res.status).toBe(422);
      expect(paymentLinkCreateMock).not.toHaveBeenCalled();
    });

    it('rejects without a valid access token', async () => {
      await request(app)
        .post('/api/onboarding-fee/checkout')
        .send({ redirectUrl: REDIRECT_URL })
        .expect(401);
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAsCustomer('ob-customer2@example.com');

      const res = await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: REDIRECT_URL });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/onboarding-fee/callback', () => {
    it('confirms payment and redirects to redirectUrl on a valid signature with a paid status', async () => {
      const { accessToken, userId } = await registerAndLogin('ob4@example.com');
      paymentLinkCreateMock.mockResolvedValue({
        id: 'plink_3',
        status: 'created',
        short_url: 'https://rzp.io/i/ghi',
      });
      await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: REDIRECT_URL });

      const params = {
        paymentLinkId: 'plink_3',
        paymentLinkReferenceId: userId,
        paymentLinkStatus: 'paid',
        paymentId: 'pay_1',
      };
      const signature = signCallbackParams(params);

      const res = await request(app).get('/api/onboarding-fee/callback').query({
        razorpay_payment_id: params.paymentId,
        razorpay_payment_link_id: params.paymentLinkId,
        razorpay_payment_link_reference_id: params.paymentLinkReferenceId,
        razorpay_payment_link_status: params.paymentLinkStatus,
        razorpay_signature: signature,
        redirectUrl: REDIRECT_URL,
      });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(REDIRECT_URL);

      const status = await request(app)
        .get('/api/onboarding-fee/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(status.body.data.status).toBe('paid');
    });

    it('rejects with 401 on an invalid signature, and does not change status', async () => {
      const { accessToken, userId } = await registerAndLogin('ob5@example.com');
      paymentLinkCreateMock.mockResolvedValue({
        id: 'plink_4',
        status: 'created',
        short_url: 'https://rzp.io/i/jkl',
      });
      await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: REDIRECT_URL });

      const res = await request(app).get('/api/onboarding-fee/callback').query({
        razorpay_payment_id: 'pay_2',
        razorpay_payment_link_id: 'plink_4',
        razorpay_payment_link_reference_id: userId,
        razorpay_payment_link_status: 'paid',
        razorpay_signature: 'not-the-real-signature',
        redirectUrl: REDIRECT_URL,
      });

      expect(res.status).toBe(401);

      const status = await request(app)
        .get('/api/onboarding-fee/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(status.body.data.status).toBe('unpaid');
    });

    it('rejects with 400 when the signature is valid but the status is not paid', async () => {
      const { accessToken, userId } = await registerAndLogin('ob6@example.com');
      paymentLinkCreateMock.mockResolvedValue({
        id: 'plink_5',
        status: 'created',
        short_url: 'https://rzp.io/i/mno',
      });
      await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: REDIRECT_URL });

      const params = {
        paymentLinkId: 'plink_5',
        paymentLinkReferenceId: userId,
        paymentLinkStatus: 'cancelled',
        paymentId: 'pay_3',
      };
      const signature = signCallbackParams(params);

      const res = await request(app).get('/api/onboarding-fee/callback').query({
        razorpay_payment_id: params.paymentId,
        razorpay_payment_link_id: params.paymentLinkId,
        razorpay_payment_link_reference_id: params.paymentLinkReferenceId,
        razorpay_payment_link_status: params.paymentLinkStatus,
        razorpay_signature: signature,
        redirectUrl: REDIRECT_URL,
      });

      expect(res.status).toBe(400);

      const status = await request(app)
        .get('/api/onboarding-fee/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(status.body.data.status).toBe('unpaid');
    });

    it('rejects with 400 for a valid signature referencing an unknown payment-link id', async () => {
      const params = {
        paymentLinkId: 'plink_never_created',
        paymentLinkReferenceId: 'someone',
        paymentLinkStatus: 'paid',
        paymentId: 'pay_4',
      };
      const signature = signCallbackParams(params);

      const res = await request(app).get('/api/onboarding-fee/callback').query({
        razorpay_payment_id: params.paymentId,
        razorpay_payment_link_id: params.paymentLinkId,
        razorpay_payment_link_reference_id: params.paymentLinkReferenceId,
        razorpay_payment_link_status: params.paymentLinkStatus,
        razorpay_signature: signature,
        redirectUrl: REDIRECT_URL,
      });

      expect(res.status).toBe(400);
    });

    it('rejects a malformed query (missing required params) with a validation error', async () => {
      await request(app)
        .get('/api/onboarding-fee/callback')
        .query({ redirectUrl: REDIRECT_URL })
        .expect(422);
    });
  });

  describe('POST /api/onboarding-fee/webhook', () => {
    it('marks the fee paid on a validly signed payment_link.paid event', async () => {
      const { accessToken } = await registerAndLogin('ob7@example.com');
      paymentLinkCreateMock.mockResolvedValue({
        id: 'plink_6',
        status: 'created',
        short_url: 'https://rzp.io/i/pqr',
      });
      await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: REDIRECT_URL });

      const { raw, signature } = signWebhookBody(paidWebhookPayload('plink_6'));
      const webhookRes = await request(app)
        .post('/api/onboarding-fee/webhook')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(raw);

      expect(webhookRes.status).toBe(200);

      const status = await request(app)
        .get('/api/onboarding-fee/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(status.body.data.status).toBe('paid');
    });

    it('rejects a webhook with an invalid signature, with 401, and does not change status', async () => {
      const { accessToken } = await registerAndLogin('ob8@example.com');
      paymentLinkCreateMock.mockResolvedValue({
        id: 'plink_7',
        status: 'created',
        short_url: 'https://rzp.io/i/stu',
      });
      await request(app)
        .post('/api/onboarding-fee/checkout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ redirectUrl: REDIRECT_URL });

      const raw = JSON.stringify(paidWebhookPayload('plink_7'));
      const res = await request(app)
        .post('/api/onboarding-fee/webhook')
        .set('X-Razorpay-Signature', 'not-the-real-signature')
        .set('Content-Type', 'application/json')
        .send(raw);

      expect(res.status).toBe(401);

      const status = await request(app)
        .get('/api/onboarding-fee/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(status.body.data.status).toBe('unpaid');
    });

    it('rejects a webhook with no signature header, with 401', async () => {
      const raw = JSON.stringify(paidWebhookPayload('plink_8'));
      await request(app)
        .post('/api/onboarding-fee/webhook')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(401);
    });

    it('returns 200 for a validly signed webhook referencing an unknown payment-link id (ignored, not an error)', async () => {
      const { raw, signature } = signWebhookBody(paidWebhookPayload('plink_never_created'));

      const res = await request(app)
        .post('/api/onboarding-fee/webhook')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(raw);

      expect(res.status).toBe(200);
    });
  });
});
