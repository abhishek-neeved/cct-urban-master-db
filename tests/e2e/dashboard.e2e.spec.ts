import request from 'supertest';
import { vi } from 'vitest';
import { Application } from 'express';
import { createApp } from '@/app';
import { UserModel } from '@modules/auth/auth.model';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

/** See kyc.e2e.spec.ts — the mobile-to-pan lookup is a real third-party API, stubbed here via fetch. */
const fetchMock = vi.fn();

const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(body) }) as unknown as Response;

const MOBILE_NUMBER = '9876543210';
const LOOKUP = {
  pan_number: 'ABCDE1234F',
  full_name: 'Ada Lovelace',
  masked_aadhaar: 'XXXXXXXX9012',
  address: { full: '221B Baker Street' },
};

describe('Dashboard API (e2e)', () => {
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
      .send({ firstName: 'Ada', lastName: 'Lovelace', email, password: 'supersecret' });
    const otp = registerRes.body.data.otpDevCode as string;
    await request(app).post('/api/auth/verify-otp').send({ email, otp }).expect(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'supersecret' });
    return loginRes.body.data.accessToken as string;
  };

  const verifyEverything = async (accessToken: string): Promise<void> => {
    const mobileReq = await request(app)
      .post('/api/kyc/verify-mobile/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mobileNumber: MOBILE_NUMBER });
    await request(app)
      .post('/api/kyc/verify-mobile/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ otp: mobileReq.body.data.devOtp });

    await request(app)
      .post('/api/kyc/verify-aadhaar')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ aadharNumber: `00000000${LOOKUP.masked_aadhaar.slice(-4)}` });

    await request(app)
      .post('/api/kyc/verify-pan')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ panNumber: LOOKUP.pan_number });
  };

  it('composes profile, default KYC/criminal-record/onboarding-fee statuses for a brand-new service provider', async () => {
    const accessToken = await registerAndLogin('dash1@example.com');

    const res = await request(app)
      .get('/api/dashboard/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      user: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'dash1@example.com',
        role: 'service_provider',
      },
      kyc: {
        status: 'not_started',
        mobileVerified: false,
        aadhaarVerified: false,
        panVerified: false,
      },
      criminalRecord: { status: 'pending' },
      onboardingFee: { status: 'unpaid', amountInRupees: 10 },
    });
  });

  it('omits KYC/criminal-record/onboarding-fee for a customer', async () => {
    const accessToken = await registerAndLogin('dash-customer@example.com');
    await UserModel.updateOne({ email: 'dash-customer@example.com' }, { role: 'customer' });

    const res = await request(app)
      .get('/api/dashboard/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      user: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'dash-customer@example.com',
        role: 'customer',
      },
    });
  });

  it('reflects real KYC and criminal-record state after admin review', async () => {
    const accessToken = await registerAndLogin('dash2@example.com');
    await verifyEverything(accessToken);
    await request(app).post('/api/kyc/submit').set('Authorization', `Bearer ${accessToken}`).send({
      addressLine: '221B Baker Street',
      district: 'Mumbai Suburban',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    const userId = me.body.data.user.id;
    await UserModel.updateOne({ email: 'dash2@example.com' }, { role: 'admin' });
    await request(app)
      .patch(`/api/admin/kyc/${userId}/approve`)
      .set('Authorization', `Bearer ${accessToken}`);
    await request(app)
      .patch(`/api/admin/criminal-record/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'flagged' });

    const res = await request(app)
      .get('/api/dashboard/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.body.data.kyc.status).toBe('verified');
    expect(res.body.data.criminalRecord.status).toBe('flagged');
  });

  it('rejects without a valid access token', async () => {
    await request(app).get('/api/dashboard/me').expect(401);
  });
});
