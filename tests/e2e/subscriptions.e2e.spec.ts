import crypto from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import type { Application } from 'express';

// Real Razorpay API calls (subscriptions.create/cancel) are mocked; the
// webhook signature check is NOT mocked — validateWebhookSignature is a pure
// local HMAC computation (no network call), so these tests compute real,
// verifiable signatures the same way Razorpay itself would.
const subscriptionsCreateMock = vi.fn();
const subscriptionsCancelMock = vi.fn();

vi.mock('razorpay', async () => {
  const actual = await vi.importActual<{ default: unknown }>('razorpay');
  const RazorpayMock = vi.fn().mockImplementation(function RazorpayMock() {
    return {
      subscriptions: { create: subscriptionsCreateMock, cancel: subscriptionsCancelMock },
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

const signWebhookBody = (body: unknown): { raw: string; signature: string } => {
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  return { raw, signature };
};

const activatedWebhookPayload = (razorpaySubscriptionId: string) => ({
  event: 'subscription.activated',
  payload: {
    subscription: {
      entity: {
        id: razorpaySubscriptionId,
        status: 'active',
        current_start: 1577836800,
        current_end: 1580515200,
        ended_at: null,
      },
    },
  },
});

describe('Subscriptions API (e2e)', () => {
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

  const registerAndLogin = async (email: string): Promise<string> => {
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ firstName: 'Test', lastName: 'User', email, password: 'supersecret', role: 'customer' });
    const otp = registerRes.body.data.otpDevCode as string;
    await request(app).post('/api/auth/verify-otp').send({ email, otp }).expect(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'supersecret' });
    return loginRes.body.data.accessToken as string;
  };

  describe('GET /api/subscriptions/me', () => {
    it('returns "inactive" before any checkout', async () => {
      const accessToken = await registerAndLogin('sub1@example.com');

      const res = await request(app)
        .get('/api/subscriptions/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('inactive');
      expect(res.body.data.plan).toEqual({
        id: 'monthly',
        name: 'Monthly plan',
        priceInRupees: 10,
        intervalLabel: 'month',
      });
    });

    it('rejects without a valid access token', async () => {
      await request(app).get('/api/subscriptions/me').expect(401);
    });
  });

  describe('POST /api/subscriptions/checkout', () => {
    it('starts checkout and returns the Razorpay short URL', async () => {
      const accessToken = await registerAndLogin('sub2@example.com');
      subscriptionsCreateMock.mockResolvedValue({
        id: 'sub_1',
        status: 'created',
        short_url: 'https://rzp.io/i/abc',
      });

      const res = await request(app)
        .post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ razorpaySubscriptionId: 'sub_1', shortUrl: 'https://rzp.io/i/abc' });

      const status = await request(app)
        .get('/api/subscriptions/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(status.body.data.status).toBe('inactive'); // not active until the webhook confirms it
    });

    it('rejects starting a second checkout while already active, with 409', async () => {
      const accessToken = await registerAndLogin('sub3@example.com');
      subscriptionsCreateMock.mockResolvedValue({
        id: 'sub_2',
        status: 'created',
        short_url: 'https://rzp.io/i/def',
      });
      await request(app)
        .post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${accessToken}`);
      const { raw, signature } = signWebhookBody(activatedWebhookPayload('sub_2'));
      await request(app)
        .post('/api/subscriptions/webhook')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(raw);

      const res = await request(app)
        .post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(409);
    });

    it('rejects without a valid access token', async () => {
      await request(app).post('/api/subscriptions/checkout').expect(401);
    });
  });

  describe('POST /api/subscriptions/webhook', () => {
    it('activates the subscription on a validly signed subscription.activated event', async () => {
      const accessToken = await registerAndLogin('sub4@example.com');
      subscriptionsCreateMock.mockResolvedValue({
        id: 'sub_3',
        status: 'created',
        short_url: 'https://rzp.io/i/ghi',
      });
      await request(app)
        .post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${accessToken}`);

      const { raw, signature } = signWebhookBody(activatedWebhookPayload('sub_3'));
      const webhookRes = await request(app)
        .post('/api/subscriptions/webhook')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(raw);

      expect(webhookRes.status).toBe(200);

      const status = await request(app)
        .get('/api/subscriptions/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(status.body.data.status).toBe('active');
      expect(status.body.data.startedAt).toEqual(new Date(1577836800 * 1000).toISOString());
      expect(status.body.data.renewsAt).toEqual(new Date(1580515200 * 1000).toISOString());
    });

    it('rejects a webhook with an invalid signature, with 401, and does not change status', async () => {
      const accessToken = await registerAndLogin('sub5@example.com');
      subscriptionsCreateMock.mockResolvedValue({
        id: 'sub_4',
        status: 'created',
        short_url: 'https://rzp.io/i/jkl',
      });
      await request(app)
        .post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${accessToken}`);

      const raw = JSON.stringify(activatedWebhookPayload('sub_4'));
      const res = await request(app)
        .post('/api/subscriptions/webhook')
        .set('X-Razorpay-Signature', 'not-the-real-signature')
        .set('Content-Type', 'application/json')
        .send(raw);

      expect(res.status).toBe(401);

      const status = await request(app)
        .get('/api/subscriptions/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(status.body.data.status).toBe('inactive');
    });

    it('rejects a webhook with no signature header, with 401', async () => {
      const raw = JSON.stringify(activatedWebhookPayload('sub_5'));
      await request(app)
        .post('/api/subscriptions/webhook')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(401);
    });

    it('returns 200 for a validly signed webhook referencing an unknown subscription (ignored, not an error)', async () => {
      const { raw, signature } = signWebhookBody(activatedWebhookPayload('sub_never_created'));

      const res = await request(app)
        .post('/api/subscriptions/webhook')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(raw);

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/subscriptions/cancel', () => {
    it('cancels an active subscription', async () => {
      const accessToken = await registerAndLogin('sub6@example.com');
      subscriptionsCreateMock.mockResolvedValue({
        id: 'sub_6',
        status: 'created',
        short_url: 'https://rzp.io/i/mno',
      });
      subscriptionsCancelMock.mockResolvedValue({});
      await request(app)
        .post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${accessToken}`);
      const { raw, signature } = signWebhookBody(activatedWebhookPayload('sub_6'));
      await request(app)
        .post('/api/subscriptions/webhook')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(raw);

      const res = await request(app)
        .post('/api/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(subscriptionsCancelMock).toHaveBeenCalledWith('sub_6', false);
    });

    it('rejects cancelling when there is no active subscription, with 400', async () => {
      const accessToken = await registerAndLogin('sub7@example.com');

      const res = await request(app)
        .post('/api/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(subscriptionsCancelMock).not.toHaveBeenCalled();
    });

    it('rejects without a valid access token', async () => {
      await request(app).post('/api/subscriptions/cancel').expect(401);
    });
  });
});
