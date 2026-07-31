import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
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

  const registerAndLogin = async (): Promise<string> => {
    const registerRes = await request(app).post('/api/auth/register').send(credentials);
    const otp = registerRes.body.data.otpDevCode as string;
    await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: credentials.email, otp })
      .expect(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    return loginRes.body.data.accessToken as string;
  };

  it('returns the authenticated user profile, including role, from /api/users/me', async () => {
    const accessToken = await registerAndLogin();

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(credentials.email);
    expect(res.body.data.user.role).toBe('user');
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
});
