import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
import { UserModel } from '@modules/auth/auth.model';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

const credentials = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  password: 'supersecret',
};

describe('Users API (e2e)', () => {
  let app: Application;

  beforeAll(async () => {
    await connectTestDb();
    app = createApp();
  });
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  // Every self-registered account is a service_provider — there is no
  // account-type choice at signup anymore.
  const registerAndLogin = async (overrides: Partial<typeof credentials> = {}): Promise<string> => {
    const payload = { ...credentials, ...overrides };
    const registerRes = await request(app).post('/api/auth/register').send(payload);
    const otp = registerRes.body.data.otpDevCode as string;
    await request(app).post('/api/auth/verify-otp').send({ email: payload.email, otp }).expect(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password });
    return loginRes.body.data.accessToken as string;
  };

  it('returns the authenticated user profile, including role, from /api/users/me', async () => {
    const accessToken = await registerAndLogin();

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(credentials.email);
    expect(res.body.data.user.role).toBe('service_provider');
    expect(res.body.data.user).not.toHaveProperty('password');
  });

  it('rejects /api/users/me without a valid access token', async () => {
    await request(app).get('/api/users/me').expect(401);
  });

  it('updates firstName/lastName via PATCH /api/users/me', async () => {
    const accessToken = await registerAndLogin();

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Grace' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.firstName).toBe('Grace');
    expect(res.body.data.user.lastName).toBe(credentials.lastName);

    const reread = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(reread.body.data.user.firstName).toBe('Grace');
  });

  it('rejects an empty PATCH body with 422', async () => {
    const accessToken = await registerAndLogin();

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(422);
  });

  it('updates phoneNumber via PATCH /api/users/me', async () => {
    const accessToken = await registerAndLogin({ email: 'phone1@example.com' });

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ phoneNumber: '+919876543210' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.phoneNumber).toBe('+919876543210');

    const reread = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(reread.body.data.user.phoneNumber).toBe('+919876543210');
  });

  it('rejects an invalid phoneNumber with 422', async () => {
    const accessToken = await registerAndLogin({ email: 'phone2@example.com' });

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ phoneNumber: 'not-a-phone-number' });

    expect(res.status).toBe(422);
  });

  describe('PATCH /api/users/me/service-category', () => {
    it('sets the category for a service provider', async () => {
      const accessToken = await registerAndLogin({ email: 'provider1@example.com' });

      const res = await request(app)
        .patch('/api/users/me/service-category')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ serviceCategory: 'plumber' });

      expect(res.status).toBe(200);
      expect(res.body.data.user.serviceCategory).toBe('plumber');

      const reread = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(reread.body.data.user.serviceCategory).toBe('plumber');
    });

    it('allows changing an already-set category — editable any time', async () => {
      const accessToken = await registerAndLogin({ email: 'provider2@example.com' });
      await request(app)
        .patch('/api/users/me/service-category')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ serviceCategory: 'plumber' });

      const res = await request(app)
        .patch('/api/users/me/service-category')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ serviceCategory: 'electrician' });

      expect(res.status).toBe(200);
      expect(res.body.data.user.serviceCategory).toBe('electrician');
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAndLogin({ email: 'customer1@example.com' });
      await UserModel.updateOne({ email: 'customer1@example.com' }, { role: 'customer' });

      const res = await request(app)
        .patch('/api/users/me/service-category')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ serviceCategory: 'plumber' });

      expect(res.status).toBe(403);
    });

    it('rejects an invalid category with 422', async () => {
      const accessToken = await registerAndLogin({ email: 'provider3@example.com' });

      const res = await request(app)
        .patch('/api/users/me/service-category')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ serviceCategory: 'not-a-real-category' });

      expect(res.status).toBe(422);
    });

    it('rejects without a valid access token', async () => {
      await request(app)
        .patch('/api/users/me/service-category')
        .send({ serviceCategory: 'plumber' })
        .expect(401);
    });
  });
});
