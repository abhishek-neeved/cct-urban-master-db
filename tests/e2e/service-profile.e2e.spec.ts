import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
import { UserModel } from '@modules/auth/auth.model';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

describe('Service Profile API (e2e)', () => {
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

  describe('GET /api/service-profile/me', () => {
    it('returns a null profile before one has been set', async () => {
      const accessToken = await registerAndLogin('provider1@example.com');

      const res = await request(app)
        .get('/api/service-profile/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.profile).toBeNull();
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAsCustomer('customer1@example.com');

      const res = await request(app)
        .get('/api/service-profile/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });

    it('rejects without a valid access token', async () => {
      await request(app).get('/api/service-profile/me').expect(401);
    });
  });

  describe('PUT /api/service-profile/me', () => {
    it('sets a profile with description and years of experience, and mirrors the category onto the user', async () => {
      const accessToken = await registerAndLogin('provider2@example.com');

      const res = await request(app)
        .put('/api/service-profile/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ category: 'electrician', description: 'Residential wiring', yearsOfExperience: 5 });

      expect(res.status).toBe(200);
      expect(res.body.data.profile).toEqual({
        category: 'electrician',
        description: 'Residential wiring',
        yearsOfExperience: 5,
      });

      const me = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(me.body.data.user.serviceCategory).toBe('electrician');
    });

    it('allows changing an already-set profile — editable any time', async () => {
      const accessToken = await registerAndLogin('provider3@example.com');
      await request(app)
        .put('/api/service-profile/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ category: 'plumber' });

      const res = await request(app)
        .put('/api/service-profile/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ category: 'carpenter', yearsOfExperience: 2 });

      expect(res.status).toBe(200);
      expect(res.body.data.profile).toEqual({
        category: 'carpenter',
        description: null,
        yearsOfExperience: 2,
      });
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAsCustomer('customer2@example.com');

      const res = await request(app)
        .put('/api/service-profile/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ category: 'plumber' });

      expect(res.status).toBe(403);
    });

    it('rejects an invalid category with 422', async () => {
      const accessToken = await registerAndLogin('provider4@example.com');

      const res = await request(app)
        .put('/api/service-profile/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ category: 'not-a-real-category' });

      expect(res.status).toBe(422);
    });

    it('rejects without a valid access token', async () => {
      await request(app).put('/api/service-profile/me').send({ category: 'plumber' }).expect(401);
    });
  });
});
