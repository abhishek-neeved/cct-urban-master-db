import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

// getSignedUrl (@aws-sdk/s3-request-presigner) signs a URL locally — it never
// makes a network call — so these hit the real S3StorageService end to end
// without needing a live S3/MinIO endpoint reachable in CI.

const credentials = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  password: 'supersecret',
};

describe('Uploads API (e2e)', () => {
  let app: Application;

  beforeAll(async () => {
    await connectTestDb();
    app = createApp();
  });
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  const login = async (): Promise<string> => {
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

  describe('POST /api/uploads/presign', () => {
    it('returns a presigned upload URL and a key scoped to the caller', async () => {
      const accessToken = await login();

      const res = await request(app)
        .post('/api/uploads/presign')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ purpose: 'kyc-aadhar', contentType: 'image/jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.data.uploadUrl).toEqual(expect.any(String));
      expect(res.body.data.key).toMatch(/^kyc-aadhar\/.+\/.+$/);
      expect(res.body.data.expiresIn).toBeGreaterThan(0);
    });

    it('rejects without a valid access token', async () => {
      await request(app)
        .post('/api/uploads/presign')
        .send({ purpose: 'kyc-aadhar', contentType: 'image/jpeg' })
        .expect(401);
    });

    it('rejects an unrecognised purpose with 422', async () => {
      const accessToken = await login();

      const res = await request(app)
        .post('/api/uploads/presign')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ purpose: 'not-a-real-purpose', contentType: 'image/jpeg' });

      expect(res.status).toBe(422);
    });

    it('rejects an unsupported contentType with 422', async () => {
      const accessToken = await login();

      const res = await request(app)
        .post('/api/uploads/presign')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ purpose: 'kyc-aadhar', contentType: 'application/zip' });

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/uploads/view', () => {
    it("returns a view URL for a key the caller owns", async () => {
      const accessToken = await login();
      const presign = await request(app)
        .post('/api/uploads/presign')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ purpose: 'kyc-photo', contentType: 'image/png' });
      const { key } = presign.body.data;

      const res = await request(app)
        .get('/api/uploads/view')
        .query({ key })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.viewUrl).toEqual(expect.any(String));
    });

    it("rejects with 403 for a key owned by a different user", async () => {
      const ownerToken = await login();
      const presign = await request(app)
        .post('/api/uploads/presign')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ purpose: 'kyc-photo', contentType: 'image/png' });
      const { key } = presign.body.data;

      const otherRegister = await request(app)
        .post('/api/auth/register')
        .send({ ...credentials, email: 'grace@example.com' });
      const otherOtp = otherRegister.body.data.otpDevCode as string;
      await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: 'grace@example.com', otp: otherOtp });
      const otherLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'grace@example.com', password: credentials.password });
      const otherToken = otherLogin.body.data.accessToken as string;

      const res = await request(app)
        .get('/api/uploads/view')
        .query({ key })
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });

    it('rejects without a valid access token', async () => {
      await request(app).get('/api/uploads/view').query({ key: 'kyc-photo/u1/uuid' }).expect(401);
    });

    it('rejects a missing key query param with 422', async () => {
      const accessToken = await login();

      const res = await request(app)
        .get('/api/uploads/view')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(422);
    });
  });
});
