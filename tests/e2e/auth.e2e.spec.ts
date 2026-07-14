import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

const credentials = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
  password: 'supersecret',
};

describe('Auth API (e2e)', () => {
  let app: Application;

  beforeAll(async () => {
    await connectTestDb();
    app = createApp();
  });
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  const register = () => request(app).post('/api/auth/register').send(credentials);
  const login = () =>
    request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password });

  it('registers a new user without issuing tokens', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(credentials.email);
    expect(res.body.data.user).not.toHaveProperty('password');
    expect(res.body.data).not.toHaveProperty('accessToken');
    expect(res.body.data).not.toHaveProperty('refreshToken');
  });

  it('rejects a duplicate registration with 409', async () => {
    await register();
    const res = await register();
    expect(res.status).toBe(409);
  });

  it('rejects a weak password with 422', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...credentials, password: 'short' });
    expect(res.status).toBe(422);
  });

  it('returns the current user from /me with a valid access token, 401 without', async () => {
    await register();
    const { body } = await login();
    const { accessToken } = body.data;

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(credentials.email);
    expect(me.body.data.user).not.toHaveProperty('password');

    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage').expect(401);
  });

  it('logs in with valid credentials and rejects invalid ones', async () => {
    await register();

    const ok = await login();
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toEqual(expect.any(String));

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });

  it('exchanges a refresh token for new tokens and revokes the old one', async () => {
    await register();
    const { body } = await login();
    const { refreshToken } = body.data;

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));

    // The original refresh token was rotated out — reusing it must fail.
    const reused = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(reused.status).toBe(401);
  });

  it('lets only one of two concurrent refreshes with the same token succeed', async () => {
    await register();
    const { body } = await login();
    const { refreshToken } = body.data;

    const [a, b] = await Promise.all([
      request(app).post('/api/auth/refresh').send({ refreshToken }),
      request(app).post('/api/auth/refresh').send({ refreshToken }),
    ]);

    const statuses = [a.status, b.status].sort();
    // Atomic rotation: exactly one wins (200), the other is rejected (401).
    expect(statuses).toEqual([200, 401]);
  });

  it('logs out so the refresh token can no longer be used', async () => {
    await register();
    const { body } = await login();
    const { refreshToken } = body.data;

    await request(app).post('/api/auth/logout').send({ refreshToken }).expect(200);

    const reused = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(reused.status).toBe(401);
  });

  it('runs the full forgot → verify → reset → login flow', async () => {
    await register();

    // 1. Request a reset. In non-production the raw token comes back for testing.
    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: credentials.email });
    expect(forgot.status).toBe(200);
    const token = forgot.body.data.resetToken as string;
    expect(token).toEqual(expect.any(String));

    // 2. Verify the token is valid.
    const verify = await request(app)
      .get('/api/auth/verify-forgot-password-token')
      .query({ token });
    expect(verify.status).toBe(200);
    expect(verify.body.data.valid).toBe(true);

    // 3. Reset the password.
    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'a-new-password' });
    expect(reset.status).toBe(200);

    // 4. Old password no longer works; new one does.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'a-new-password' });
    expect(newLogin.status).toBe(200);

    // 5. The reset token is single-use.
    const reuse = await request(app).get('/api/auth/verify-forgot-password-token').query({ token });
    expect(reuse.body.data.valid).toBe(false);
  });

  it('does not reveal whether an email exists on forgot-password', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.resetToken).toBeUndefined();
  });
});
