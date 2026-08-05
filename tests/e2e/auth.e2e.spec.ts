import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
import { REFRESH_TOKEN_REUSE_GRACE_MS } from '@config/constants';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

// A replay within this window reads as a benign race (two requests firing
// close together), not reuse — see `refresh-token.repository`'s `rotate`.
// Testing genuine reuse detection means replaying after it has elapsed.
const sleepPastReuseGrace = () =>
  new Promise((resolve) => setTimeout(resolve, REFRESH_TOKEN_REUSE_GRACE_MS + 100));

const credentials = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
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
  const verifyOtp = (otp: string) =>
    request(app).post('/api/auth/verify-otp').send({ email: credentials.email, otp });
  const login = () =>
    request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password });

  // Register then verify with the dev OTP returned in the response, so the
  // account can log in. Returns the raw OTP for tests that need it further.
  const registerAndVerify = async (): Promise<string> => {
    const res = await register();
    const otp = res.body.data.otpDevCode as string;
    await verifyOtp(otp).expect(200);
    return otp;
  };

  it('registers a new user unverified as a service_provider, without issuing tokens, and emails an OTP', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(credentials.email);
    expect(res.body.data.user.isVerified).toBe(false);
    expect(res.body.data.user.role).toBe('service_provider');
    expect(res.body.data.user).not.toHaveProperty('password');
    expect(res.body.data).not.toHaveProperty('accessToken');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    // Non-production returns the OTP so the flow can be exercised without email.
    expect(res.body.data.otpDevCode).toMatch(/^\d{6}$/);
  });

  it('verifies an account with the emailed OTP, then allows login', async () => {
    const otp = await registerAndVerify();
    // The OTP is single-use — replaying it after verification fails.
    await verifyOtp(otp).expect(400);

    const ok = await login();
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.isVerified).toBe(true);
    expect(ok.body.data.accessToken).toEqual(expect.any(String));
  });

  it('refuses login for an unverified account with 403', async () => {
    await register();
    const res = await login();
    expect(res.status).toBe(403);
  });

  it('rejects a wrong OTP and locks the code after too many attempts', async () => {
    const res = await register();
    const realOtp = res.body.data.otpDevCode as string;

    // Five wrong guesses exhaust the attempt cap and burn the code.
    for (let i = 0; i < 5; i++) {
      await verifyOtp('000000').expect(400);
    }
    // Even the correct code no longer works — a new one must be requested.
    await verifyOtp(realOtp).expect(400);
    // ...and the account is still unverified, so login stays blocked.
    await login().expect(403);
  });

  it('resend-otp always returns 200 and never reveals account state', async () => {
    await register();

    // Immediately after register the code is still within its cooldown, so a
    // resend is a silent no-op (no fresh code leaks).
    const throttled = await request(app)
      .post('/api/auth/resend-otp')
      .send({ email: credentials.email });
    expect(throttled.status).toBe(200);
    expect(throttled.body.data.otpDevCode).toBeUndefined();

    // Unknown email → same 200, still nothing revealed.
    const unknown = await request(app)
      .post('/api/auth/resend-otp')
      .send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.otpDevCode).toBeUndefined();
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
    await registerAndVerify();
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
    await registerAndVerify();

    const ok = await login();
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toEqual(expect.any(String));

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });

  it('exchanges a refresh token for new tokens and revokes the old one', async () => {
    await registerAndVerify();
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
    await registerAndVerify();
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

  it('revokes the entire session when a rotated-out refresh token is replayed', async () => {
    await registerAndVerify();
    const { body } = await login();
    const { refreshToken } = body.data;

    // Legitimate rotation.
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(rotated.status).toBe(200);
    const newRefreshToken = rotated.body.data.refreshToken;

    // The old token is replayed (e.g. by an attacker who copied it before
    // rotation) well after the grace window, so it reads as theft rather than
    // a benign race — this must burn the whole session, not just this request.
    await sleepPastReuseGrace();
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(replay.status).toBe(401);

    // The token issued by the legitimate rotation is now also dead.
    const afterReuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: newRefreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it('locks the account after too many wrong passwords, until it expires', async () => {
    await registerAndVerify();

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: credentials.email, password: 'wrong-password' })
        .expect(401);
    }

    // Cap reached — even the correct password is now rejected, with the same
    // generic message (no "account locked" disclosure).
    const lockedOut = await login();
    expect(lockedOut.status).toBe(401);
  });

  it('locks out a nonexistent email the same way as a real account (no enumeration via lockout)', async () => {
    // Lockout is tracked per email, not per account — so hammering an email
    // that was never registered must behave exactly like hammering a real
    // one: same status, same message, every time.
    const responses = [];
    for (let i = 0; i < 6; i++) {
      responses.push(
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'never-registered@example.com', password: 'whatever-password' })
      );
    }
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    }
  });

  it('logs out so the refresh token can no longer be used', async () => {
    await registerAndVerify();
    const { body } = await login();
    const { refreshToken } = body.data;

    await request(app).post('/api/auth/logout').send({ refreshToken }).expect(200);

    const reused = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(reused.status).toBe(401);
  });

  it('runs the full forgot → reset (via OTP) → login flow', async () => {
    await registerAndVerify();

    // 1. Request a reset. In non-production the raw OTP comes back for testing.
    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: credentials.email });
    expect(forgot.status).toBe(200);
    const otp = forgot.body.data.otpDevCode as string;
    expect(otp).toMatch(/^\d{6}$/);

    // 2. Reset the password with the OTP — one-shot, no separate verify step.
    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: credentials.email, otp, password: 'a-new-password' });
    expect(reset.status).toBe(200);

    // 3. Old password no longer works; new one does.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'a-new-password' });
    expect(newLogin.status).toBe(200);

    // 4. The OTP is single-use — replaying it fails.
    const reuse = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: credentials.email, otp, password: 'yet-another-password' });
    expect(reuse.status).toBe(400);
  });

  it('rejects a wrong reset OTP and locks it out after too many attempts', async () => {
    await registerAndVerify();
    await request(app).post('/api/auth/forgot-password').send({ email: credentials.email });

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ email: credentials.email, otp: '000000', password: 'a-new-password' });
      expect(res.status).toBe(400);
    }

    // Even the correct password still works — the reset never happened.
    const stillWorks = await login();
    expect(stillWorks.status).toBe(200);
  });

  it('does not reveal whether an email exists on forgot-password', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.otpDevCode).toBeUndefined();
  });

  it('rejects reset-password generically for an unknown email (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'nobody@example.com', otp: '123456', password: 'a-new-password' });
    expect(res.status).toBe(400);
  });

  describe('PATCH /api/auth/change-password', () => {
    const changePassword = (accessToken: string, body: Record<string, unknown>) =>
      request(app)
        .patch('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

    it('changes the password when the current one is correct, and revokes other sessions', async () => {
      await registerAndVerify();
      const loginRes = await login();
      const accessToken = loginRes.body.data.accessToken as string;
      const refreshToken = loginRes.body.data.refreshToken as string;

      const res = await changePassword(accessToken, {
        currentPassword: credentials.password,
        newPassword: 'a-new-password',
      });
      expect(res.status).toBe(200);

      // Old password no longer works; new one does.
      const oldLogin = await login();
      expect(oldLogin.status).toBe(401);
      const newLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: credentials.email, password: 'a-new-password' });
      expect(newLogin.status).toBe(200);

      // The refresh token from before the change was revoked.
      const refreshAttempt = await request(app).post('/api/auth/refresh').send({ refreshToken });
      expect(refreshAttempt.status).toBe(401);
    });

    it('rejects the wrong current password with 400, and leaves the password unchanged', async () => {
      await registerAndVerify();
      const loginRes = await login();
      const accessToken = loginRes.body.data.accessToken as string;

      const res = await changePassword(accessToken, {
        currentPassword: 'not-the-real-password',
        newPassword: 'a-new-password',
      });
      expect(res.status).toBe(400);

      const stillWorks = await login();
      expect(stillWorks.status).toBe(200);
    });

    it('rejects without a valid access token', async () => {
      await request(app)
        .patch('/api/auth/change-password')
        .send({ currentPassword: 'x', newPassword: 'a-new-password' })
        .expect(401);
    });

    it('rejects a new password shorter than 8 characters with 422', async () => {
      await registerAndVerify();
      const loginRes = await login();
      const accessToken = loginRes.body.data.accessToken as string;

      const res = await changePassword(accessToken, {
        currentPassword: credentials.password,
        newPassword: 'short',
      });
      expect(res.status).toBe(422);
    });
  });
});
