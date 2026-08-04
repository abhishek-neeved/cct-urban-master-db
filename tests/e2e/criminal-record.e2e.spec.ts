import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
import { UserModel } from '@modules/auth/auth.model';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

describe('Criminal Record API (e2e)', () => {
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

  describe('GET /api/criminal-record/me', () => {
    it('returns "pending" before any admin action', async () => {
      const accessToken = await registerAndLogin('cr1@example.com');

      const res = await request(app)
        .get('/api/criminal-record/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ status: 'pending' });
    });

    it('rejects without a valid access token', async () => {
      await request(app).get('/api/criminal-record/me').expect(401);
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAsCustomer('customer1@example.com');

      const res = await request(app)
        .get('/api/criminal-record/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/admin/criminal-record/:userId', () => {
    it('sets the status for a user (admin only)', async () => {
      const userToken = await registerAndLogin('cr2@example.com');
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('cradmin1@example.com');

      const res = await request(app)
        .patch(`/api/admin/criminal-record/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'clear' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('clear');
      expect(res.body.data.checkedAt).toBeDefined();

      const statusAfter = await request(app)
        .get('/api/criminal-record/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(statusAfter.body.data.status).toBe('clear');
    });

    it('rejects a non-admin with 403', async () => {
      const userToken = await registerAndLogin('cr3@example.com');
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;

      const res = await request(app)
        .patch(`/api/admin/criminal-record/${userId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ status: 'clear' });

      expect(res.status).toBe(403);
    });

    it('rejects without a valid access token', async () => {
      await request(app)
        .patch('/api/admin/criminal-record/000000000000000000000000')
        .send({ status: 'clear' })
        .expect(401);
    });

    it('rejects an invalid status with 422', async () => {
      const adminToken = await registerAdmin('cradmin2@example.com');

      const res = await request(app)
        .patch('/api/admin/criminal-record/000000000000000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'not-a-real-status' });

      expect(res.status).toBe(422);
    });

    it('rejects an invalid userId path param with 422', async () => {
      const adminToken = await registerAdmin('cradmin3@example.com');

      const res = await request(app)
        .patch('/api/admin/criminal-record/not-a-valid-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'clear' });

      expect(res.status).toBe(422);
    });
  });
});
