import request from 'supertest';
import { vi } from 'vitest';
import { Application } from 'express';
import { createApp } from '@/app';
import { UserModel } from '@modules/auth/auth.model';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

/**
 * `HttpMobileVerificationProvider` (see `@shared/services/mobile-verification.service`)
 * calls a real, billed third-party API via `fetch`. Mirrors how
 * `onboarding-fee.e2e.spec.ts` mocks the Razorpay SDK for the same reason —
 * an e2e test must never make a real outbound call to a paid third party.
 */
const fetchMock = vi.fn();

const jsonResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}): Response =>
  ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

const MOBILE_NUMBER = '9876543210';
const LOOKUP = {
  pan_number: 'ABCDE1234F',
  full_name: 'Test User',
  masked_aadhaar: 'XXXXXXXX9012',
  address: { full: '221B Baker Street' },
};

describe('KYC API (e2e)', () => {
  let app: Application;

  beforeAll(async () => {
    await connectTestDb();
    app = createApp();
  });
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: LOOKUP }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Every self-registered account is a service_provider — there is no
  // account-type choice at signup anymore.
  const registerAndLogin = async (email: string): Promise<string> => {
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ firstName: 'Test', lastName: 'User', email, password: 'supersecret' });
    const otp = registerRes.body.data.otpDevCode as string;
    await request(app).post('/api/auth/verify-otp').send({ email, otp }).expect(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'supersecret' });
    return loginRes.body.data.accessToken as string;
  };

  const registerAsCustomer = async (email: string): Promise<string> => {
    const accessToken = await registerAndLogin(email);
    await UserModel.updateOne({ email }, { role: 'customer' });
    return accessToken;
  };

  const registerAdmin = async (email: string): Promise<string> => {
    const accessToken = await registerAndLogin(email);
    await UserModel.updateOne({ email }, { role: 'admin' });
    return accessToken;
  };

  /** Requests + confirms the mobile OTP, leaving the account with a verified mobile number. */
  const verifyMobile = async (accessToken: string): Promise<void> => {
    const requestRes = await request(app)
      .post('/api/kyc/verify-mobile/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mobileNumber: MOBILE_NUMBER });
    await request(app)
      .post('/api/kyc/verify-mobile/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ otp: requestRes.body.data.devOtp })
      .expect(200);
  };

  /** Full happy path up to (not including) /submit: mobile + Aadhaar + PAN, all matching LOOKUP. */
  const verifyEverything = async (accessToken: string): Promise<void> => {
    await verifyMobile(accessToken);
    await request(app)
      .post('/api/kyc/verify-aadhaar')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ aadharNumber: `00000000${LOOKUP.masked_aadhaar.slice(-4)}` })
      .expect(200);
    await request(app)
      .post('/api/kyc/verify-pan')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ panNumber: LOOKUP.pan_number })
      .expect(200);
  };

  describe('GET /api/kyc/me', () => {
    it('returns "not_started" before any verification', async () => {
      const accessToken = await registerAndLogin('user1@example.com');

      const res = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        status: 'not_started',
        mobileVerified: false,
        aadhaarVerified: false,
        panVerified: false,
      });
    });

    it('rejects without a valid access token', async () => {
      await request(app).get('/api/kyc/me').expect(401);
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAsCustomer('customer1@example.com');

      const res = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/kyc/verify-mobile/request + /confirm', () => {
    it('requests and confirms a mobile OTP', async () => {
      const accessToken = await registerAndLogin('verify1@example.com');

      const requestRes = await request(app)
        .post('/api/kyc/verify-mobile/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ mobileNumber: MOBILE_NUMBER });
      expect(requestRes.status).toBe(200);
      const otp = requestRes.body.data.devOtp as string;
      expect(otp).toMatch(/^\d{6}$/);

      const confirmRes = await request(app)
        .post('/api/kyc/verify-mobile/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ otp });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.mobileVerified).toBe(true);
      expect(confirmRes.body.data.mobileNumber).toBe(MOBILE_NUMBER);
    });

    it('rejects a wrong mobile OTP with 400', async () => {
      const accessToken = await registerAndLogin('verify2@example.com');
      await request(app)
        .post('/api/kyc/verify-mobile/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ mobileNumber: MOBILE_NUMBER });

      const res = await request(app)
        .post('/api/kyc/verify-mobile/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ otp: '000000' });

      expect(res.status).toBe(400);
    });

    it('rejects confirming without ever requesting, with 400', async () => {
      const accessToken = await registerAndLogin('verify2b@example.com');

      const res = await request(app)
        .post('/api/kyc/verify-mobile/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ otp: '000000' });

      expect(res.status).toBe(400);
    });

    it('rejects an invalid mobile number with 422', async () => {
      const accessToken = await registerAndLogin('verify2c@example.com');

      const res = await request(app)
        .post('/api/kyc/verify-mobile/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ mobileNumber: '12345' });

      expect(res.status).toBe(422);
    });

    it('rejects verification requests from a customer with 403', async () => {
      const accessToken = await registerAsCustomer('verify2d@example.com');

      const res = await request(app)
        .post('/api/kyc/verify-mobile/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ mobileNumber: MOBILE_NUMBER });

      expect(res.status).toBe(403);
    });

    it('rejects without a valid access token', async () => {
      await request(app)
        .post('/api/kyc/verify-mobile/request')
        .send({ mobileNumber: MOBILE_NUMBER })
        .expect(401);
    });
  });

  describe('POST /api/kyc/verify-aadhaar', () => {
    it('verifies successfully when the last 4 digits match the mobile-linked lookup', async () => {
      const accessToken = await registerAndLogin('verify3@example.com');
      await verifyMobile(accessToken);

      const res = await request(app)
        .post('/api/kyc/verify-aadhaar')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ aadharNumber: `00000000${LOOKUP.masked_aadhaar.slice(-4)}` });

      expect(res.status).toBe(200);
      expect(res.body.data.aadhaarVerified).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mobile_number: MOBILE_NUMBER }),
        })
      );
    });

    it('rejects a mismatched Aadhaar number with 400', async () => {
      const accessToken = await registerAndLogin('verify4@example.com');
      await verifyMobile(accessToken);

      const res = await request(app)
        .post('/api/kyc/verify-aadhaar')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ aadharNumber: '000000000000' });

      expect(res.status).toBe(400);
    });

    it('rejects before the mobile number is verified, with 400', async () => {
      const accessToken = await registerAndLogin('verify5@example.com');

      const res = await request(app)
        .post('/api/kyc/verify-aadhaar')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ aadharNumber: `00000000${LOOKUP.masked_aadhaar.slice(-4)}` });

      expect(res.status).toBe(400);
    });

    it('rejects an invalid Aadhaar number with 422', async () => {
      const accessToken = await registerAndLogin('verify6@example.com');
      await verifyMobile(accessToken);

      const res = await request(app)
        .post('/api/kyc/verify-aadhaar')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ aadharNumber: '123' });

      expect(res.status).toBe(422);
    });

    it('surfaces a 503 when the mobile-verification API is unreachable', async () => {
      const accessToken = await registerAndLogin('verify6b@example.com');
      await verifyMobile(accessToken);
      fetchMock.mockRejectedValue(new Error('network down'));

      const res = await request(app)
        .post('/api/kyc/verify-aadhaar')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ aadharNumber: `00000000${LOOKUP.masked_aadhaar.slice(-4)}` });

      expect(res.status).toBe(503);
    });

    it('rejects verification from a customer with 403', async () => {
      const accessToken = await registerAsCustomer('verify7@example.com');

      const res = await request(app)
        .post('/api/kyc/verify-aadhaar')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ aadharNumber: '123456789012' });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/kyc/verify-pan', () => {
    it('verifies successfully (case-insensitively) against the mobile-linked lookup', async () => {
      const accessToken = await registerAndLogin('verify8@example.com');
      await verifyMobile(accessToken);

      const res = await request(app)
        .post('/api/kyc/verify-pan')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ panNumber: LOOKUP.pan_number });

      expect(res.status).toBe(200);
      expect(res.body.data.panVerified).toBe(true);
    });

    it('rejects a mismatched PAN with 400', async () => {
      const accessToken = await registerAndLogin('verify9@example.com');
      await verifyMobile(accessToken);

      const res = await request(app)
        .post('/api/kyc/verify-pan')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ panNumber: 'ZZZZZ9999Z' });

      expect(res.status).toBe(400);
    });

    it('rejects before the mobile number is verified, with 400', async () => {
      const accessToken = await registerAndLogin('verify10@example.com');

      const res = await request(app)
        .post('/api/kyc/verify-pan')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ panNumber: LOOKUP.pan_number });

      expect(res.status).toBe(400);
    });

    it('rejects an invalid PAN with 422', async () => {
      const accessToken = await registerAndLogin('verify11@example.com');
      await verifyMobile(accessToken);

      const res = await request(app)
        .post('/api/kyc/verify-pan')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ panNumber: 'not-a-pan' });

      expect(res.status).toBe(422);
    });

    it('rejects verification from a customer with 403', async () => {
      const accessToken = await registerAsCustomer('verify12@example.com');

      const res = await request(app)
        .post('/api/kyc/verify-pan')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ panNumber: LOOKUP.pan_number });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/kyc/submit', () => {
    it('submits and moves status to pending once mobile/Aadhaar/PAN are all verified', async () => {
      const accessToken = await registerAndLogin('user2@example.com');
      await verifyEverything(accessToken);

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ address: '221B Baker Street' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.address).toBe('221B Baker Street');

      const me = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(me.body.data.status).toBe('pending');
    });

    it('rejects submission before verifying mobile/Aadhaar/PAN, with 400', async () => {
      const accessToken = await registerAndLogin('user2b@example.com');

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ address: '221B Baker Street' });

      expect(res.status).toBe(400);
    });

    it('rejects submission when mobile is verified but Aadhaar/PAN are not, with 400', async () => {
      const accessToken = await registerAndLogin('user2c@example.com');
      await verifyMobile(accessToken);

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ address: '221B Baker Street' });

      expect(res.status).toBe(400);
    });

    it('rejects a missing address with 422', async () => {
      const accessToken = await registerAndLogin('user3@example.com');
      await verifyEverything(accessToken);

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ address: '' });

      expect(res.status).toBe(422);
    });

    it('rejects a second submission while the first is still pending, with 400', async () => {
      const accessToken = await registerAndLogin('user5@example.com');
      await verifyEverything(accessToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ address: '221B Baker Street' });

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ address: '221B Baker Street' });

      expect(res.status).toBe(400);
    });

    it('rejects without a valid access token', async () => {
      await request(app).post('/api/kyc/submit').send({ address: '221B Baker Street' }).expect(401);
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAsCustomer('customer2@example.com');

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ address: '221B Baker Street' });

      expect(res.status).toBe(403);
    });
  });

  describe('Admin review', () => {
    it('lists pending submissions for an admin', async () => {
      const userToken = await registerAndLogin('user6@example.com');
      await verifyEverything(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });
      const adminToken = await registerAdmin('admin1@example.com');

      const res = await request(app)
        .get('/api/admin/kyc')
        .query({ status: 'pending' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.records).toHaveLength(1);
      expect(res.body.data.records[0].status).toBe('pending');
    });

    it('excludes not_started rows when no status filter is given', async () => {
      const userToken = await registerAndLogin('user6b@example.com');
      await verifyMobile(userToken); // creates a "not_started" row, nothing more
      const adminToken = await registerAdmin('admin1b@example.com');

      const res = await request(app)
        .get('/api/admin/kyc')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.records).toHaveLength(0);
    });

    it('rejects a non-admin from listing submissions with 403', async () => {
      const userToken = await registerAndLogin('user7@example.com');

      const res = await request(app)
        .get('/api/admin/kyc')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('rejects listing without a valid access token', async () => {
      await request(app).get('/api/admin/kyc').expect(401);
    });

    it('approves a pending submission', async () => {
      const userToken = await registerAndLogin('user8@example.com');
      await verifyEverything(userToken);
      const submitRes = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin2@example.com');

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('verified');
      expect(submitRes.body.data.status).toBe('pending');

      const statusAfter = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(statusAfter.body.data.status).toBe('verified');
    });

    it('rejects a pending submission with a reason', async () => {
      const userToken = await registerAndLogin('user9@example.com');
      await verifyEverything(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin3@example.com');

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Aadhaar photo is blurry' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('rejected');
      expect(res.body.data.rejectionReason).toBe('Aadhaar photo is blurry');

      const statusAfter = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(statusAfter.body.data.status).toBe('rejected');
      expect(statusAfter.body.data.rejectionReason).toBe('Aadhaar photo is blurry');
    });

    it('rejects reject without a reason, with 422', async () => {
      const userToken = await registerAndLogin('user10@example.com');
      await verifyEverything(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin4@example.com');

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(422);
    });

    it('allows resubmission after rejection, clearing the rejection reason', async () => {
      const userToken = await registerAndLogin('user11@example.com');
      await verifyEverything(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin5@example.com');
      await request(app)
        .patch(`/api/admin/kyc/${userId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'blurry' });

      const resubmit = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });

      expect(resubmit.status).toBe(200);
      expect(resubmit.body.data.status).toBe('pending');
      expect(resubmit.body.data.rejectionReason).toBeUndefined();
    });

    it('rejects resubmission while already verified, with 400', async () => {
      const userToken = await registerAndLogin('user11b@example.com');
      await verifyEverything(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin5b@example.com');
      await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });

      expect(res.status).toBe(400);
    });

    it('rejects approving a submission that is not pending, with 400', async () => {
      const userToken = await registerAndLogin('user12@example.com');
      await verifyEverything(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin6@example.com');
      await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('returns 404 when approving a user with no submission', async () => {
      const userToken = await registerAndLogin('user13@example.com');
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin7@example.com');

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('rejects a non-admin from approving with 403', async () => {
      const userToken = await registerAndLogin('user14@example.com');
      await verifyEverything(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address: '221B Baker Street' });
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('rejects an invalid userId path param with 422', async () => {
      const adminToken = await registerAdmin('admin8@example.com');

      const res = await request(app)
        .patch('/api/admin/kyc/not-a-valid-id/approve')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
    });
  });
});
