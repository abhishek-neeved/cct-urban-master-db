import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
import { UserModel } from '@modules/auth/auth.model';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

const validSubmission = {
  aadharNumber: '123456789012',
  panNumber: 'ABCDE1234F',
  address: '221B Baker Street',
};

describe('Dashboard API (e2e)', () => {
  let app: Application;

  beforeAll(async () => {
    await connectTestDb();
    app = createApp();
  });
  afterEach(clearTestDb);
  afterAll(closeTestDb);

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

  const verifyDocuments = async (accessToken: string): Promise<void> => {
    const aadharReq = await request(app)
      .post('/api/kyc/verify-aadhar/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ aadharNumber: validSubmission.aadharNumber });
    await request(app)
      .post('/api/kyc/verify-aadhar/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ otp: aadharReq.body.data.devOtp });

    const panReq = await request(app)
      .post('/api/kyc/verify-pan/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ panNumber: validSubmission.panNumber });
    await request(app)
      .post('/api/kyc/verify-pan/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ otp: panReq.body.data.devOtp });
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
      kyc: { status: 'not_started' },
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
    await verifyDocuments(accessToken);
    await request(app)
      .post('/api/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validSubmission);
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
