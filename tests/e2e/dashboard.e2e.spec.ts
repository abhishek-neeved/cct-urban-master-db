import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
import { UserModel } from '@modules/auth/auth.model';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

describe('Dashboard API (e2e)', () => {
  let app: Application;

  beforeAll(async () => {
    await connectTestDb();
    app = createApp();
  });
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  const registerAndLogin = async (
    email: string,
    role: 'service_provider' | 'customer' = 'service_provider'
  ): Promise<string> => {
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ firstName: 'Ada', lastName: 'Lovelace', email, password: 'supersecret', role });
    const otp = registerRes.body.data.otpDevCode as string;
    await request(app).post('/api/auth/verify-otp').send({ email, otp }).expect(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'supersecret' });
    return loginRes.body.data.accessToken as string;
  };

  it('composes profile, default KYC/criminal-record/subscription statuses for a brand-new service provider', async () => {
    const accessToken = await registerAndLogin('dash1@example.com');

    const res = await request(app)
      .get('/api/dashboard/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      user: { firstName: 'Ada', lastName: 'Lovelace', email: 'dash1@example.com', role: 'service_provider' },
      kyc: { status: 'not_started' },
      criminalRecord: { status: 'pending' },
      subscription: {
        status: 'inactive',
        plan: { id: 'monthly', name: 'Monthly plan', priceInRupees: 10, intervalLabel: 'month' },
      },
    });
  });

  it('omits KYC/criminal-record/subscription for a customer', async () => {
    const accessToken = await registerAndLogin('dash-customer@example.com', 'customer');

    const res = await request(app)
      .get('/api/dashboard/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      user: { firstName: 'Ada', lastName: 'Lovelace', email: 'dash-customer@example.com', role: 'customer' },
    });
  });

  it('reflects real KYC and criminal-record state after admin review', async () => {
    const accessToken = await registerAndLogin('dash2@example.com');
    await request(app)
      .post('/api/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        aadharNumber: '123456789012',
        aadharImageKey: 'kyc-aadhar/u/a',
        panNumber: 'ABCDE1234F',
        panImageKey: 'kyc-pan/u/b',
        address: '221B Baker Street',
        photographKey: 'kyc-photo/u/c',
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
