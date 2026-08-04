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

const LOOKUP = {
  pan_number: 'ABCDE1234F',
  full_name: 'Test Provider',
  masked_aadhaar: 'XXXXXXXX9012',
  address: { full: '221B Baker Street' },
};

describe('Service Providers directory API (e2e)', () => {
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
  // account-type choice at signup anymore. Tests that need a `customer` or
  // `admin` promote the account directly in the database afterwards, same
  // as the existing admin-promotion pattern.
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
    const token = await registerAndLogin(email);
    await UserModel.updateOne({ email }, { role: 'customer' });
    return token;
  };

  const verifyEverything = async (accessToken: string): Promise<void> => {
    const mobileReq = await request(app)
      .post('/api/kyc/verify-mobile/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mobileNumber: '9876543210' });
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

  const makeVerifiedProvider = async (
    email: string,
    firstName: string,
    category: string,
    phoneNumber: string
  ): Promise<void> => {
    const providerToken = await registerAndLogin(email);
    await request(app)
      .patch('/api/users/me/service-category')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ serviceCategory: category });
    await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ firstName, phoneNumber });
    await verifyEverything(providerToken);
    await request(app)
      .post('/api/kyc/submit')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ address: '221B Baker Street' });
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${providerToken}`);
    const userId = me.body.data.user.id;
    const adminToken = await registerAndLogin(`admin-${email}`);
    await UserModel.updateOne({ email: `admin-${email}` }, { role: 'admin' });
    await request(app)
      .patch(`/api/admin/kyc/${userId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
  };

  it('lists only KYC-verified service providers', async () => {
    await makeVerifiedProvider('verified-plumber@example.com', 'Priya', 'plumber', '+919876543210');
    const providerToken = await registerAndLogin('unverified-electrician@example.com');
    await request(app)
      .patch('/api/users/me/service-category')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ serviceCategory: 'electrician' });
    const customerToken = await registerAsCustomer('customer1@example.com');

    const res = await request(app)
      .get('/api/service-providers')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.providers).toEqual([
      {
        firstName: 'Priya',
        lastName: 'User',
        serviceCategory: 'plumber',
        phoneNumber: '+919876543210',
      },
    ]);
  });

  it('filters by category', async () => {
    await makeVerifiedProvider('plumber-a@example.com', 'Amit', 'plumber', '+911111111111');
    await makeVerifiedProvider('electrician-a@example.com', 'Bala', 'electrician', '+912222222222');
    const customerToken = await registerAsCustomer('customer2@example.com');

    const res = await request(app)
      .get('/api/service-providers')
      .query({ category: 'electrician' })
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.providers).toHaveLength(1);
    expect(res.body.data.providers[0].serviceCategory).toBe('electrician');
  });

  it('is accessible to admin too', async () => {
    await makeVerifiedProvider('plumber-b@example.com', 'Chetan', 'plumber', '+913333333333');
    const adminToken = await registerAndLogin('admin-direct@example.com');
    await UserModel.updateOne({ email: 'admin-direct@example.com' }, { role: 'admin' });

    const res = await request(app)
      .get('/api/service-providers')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.providers).toHaveLength(1);
  });

  it('rejects a service_provider caller with 403', async () => {
    const providerToken = await registerAndLogin('provider-caller@example.com');

    const res = await request(app)
      .get('/api/service-providers')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(res.status).toBe(403);
  });

  it('rejects without a valid access token', async () => {
    await request(app).get('/api/service-providers').expect(401);
  });

  it('rejects an invalid category with 422', async () => {
    const customerToken = await registerAsCustomer('customer3@example.com');

    const res = await request(app)
      .get('/api/service-providers')
      .query({ category: 'not-a-real-category' })
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(422);
  });
});
