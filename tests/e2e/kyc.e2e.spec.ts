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

describe('KYC API (e2e)', () => {
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

  /** Verifies both Aadhaar and PAN for `validSubmission`'s numbers — a prerequisite for /submit. */
  const verifyDocuments = async (accessToken: string): Promise<void> => {
    const aadharReq = await request(app)
      .post('/api/kyc/verify-aadhar/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ aadharNumber: validSubmission.aadharNumber });
    await request(app)
      .post('/api/kyc/verify-aadhar/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ otp: aadharReq.body.data.devOtp })
      .expect(200);

    const panReq = await request(app)
      .post('/api/kyc/verify-pan/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ panNumber: validSubmission.panNumber });
    await request(app)
      .post('/api/kyc/verify-pan/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ otp: panReq.body.data.devOtp })
      .expect(200);
  };

  describe('GET /api/kyc/me', () => {
    it('returns "not_started" before any submission', async () => {
      const accessToken = await registerAndLogin('user1@example.com');

      const res = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ status: 'not_started' });
    });

    it('rejects without a valid access token', async () => {
      await request(app).get('/api/kyc/me').expect(401);
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAsCustomer('customer1@example.com');

      const res = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Aadhaar/PAN verification', () => {
    it('requests and confirms an Aadhaar OTP', async () => {
      const accessToken = await registerAndLogin('verify1@example.com');

      const requestRes = await request(app)
        .post('/api/kyc/verify-aadhar/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ aadharNumber: '123456789012' });
      expect(requestRes.status).toBe(200);
      expect(requestRes.body.data.maskedMobileNumber).toMatch(/^9X+\d{4}$/);
      const otp = requestRes.body.data.devOtp as string;
      expect(otp).toMatch(/^\d{6}$/);

      const confirmRes = await request(app)
        .post('/api/kyc/verify-aadhar/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ otp });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.verified).toBe(true);
    });

    it('rejects a wrong Aadhaar OTP with 400', async () => {
      const accessToken = await registerAndLogin('verify2@example.com');
      await request(app)
        .post('/api/kyc/verify-aadhar/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ aadharNumber: '123456789012' });

      const res = await request(app)
        .post('/api/kyc/verify-aadhar/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ otp: '000000' });

      expect(res.status).toBe(400);
    });

    it('requests and confirms a PAN OTP', async () => {
      const accessToken = await registerAndLogin('verify3@example.com');

      const requestRes = await request(app)
        .post('/api/kyc/verify-pan/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ panNumber: 'ABCDE1234F' });
      expect(requestRes.status).toBe(200);
      const otp = requestRes.body.data.devOtp as string;

      const confirmRes = await request(app)
        .post('/api/kyc/verify-pan/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ otp });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.verified).toBe(true);
    });

    it('rejects a wrong PAN OTP with 400', async () => {
      const accessToken = await registerAndLogin('verify4@example.com');
      await request(app)
        .post('/api/kyc/verify-pan/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ panNumber: 'ABCDE1234F' });

      const res = await request(app)
        .post('/api/kyc/verify-pan/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ otp: '000000' });

      expect(res.status).toBe(400);
    });

    it('rejects verification requests from a customer with 403', async () => {
      const accessToken = await registerAsCustomer('verify5@example.com');

      const res = await request(app)
        .post('/api/kyc/verify-aadhar/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ aadharNumber: '123456789012' });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/kyc/submit', () => {
    it('submits identity details and moves status to pending once both docs are verified', async () => {
      const accessToken = await registerAndLogin('user2@example.com');
      await verifyDocuments(accessToken);

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validSubmission);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.aadharNumber).toBe(validSubmission.aadharNumber);

      const me = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(me.body.data.status).toBe('pending');
    });

    it('rejects submission before verifying the Aadhaar/PAN numbers, with 400', async () => {
      const accessToken = await registerAndLogin('user2b@example.com');

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validSubmission);

      expect(res.status).toBe(400);
    });

    it('rejects an invalid Aadhar number with 422', async () => {
      const accessToken = await registerAndLogin('user3@example.com');

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...validSubmission, aadharNumber: '123' });

      expect(res.status).toBe(422);
    });

    it('rejects an invalid PAN with 422', async () => {
      const accessToken = await registerAndLogin('user4@example.com');

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...validSubmission, panNumber: 'not-a-pan' });

      expect(res.status).toBe(422);
    });

    it('rejects a second submission while the first is still pending, with 400', async () => {
      const accessToken = await registerAndLogin('user5@example.com');
      await verifyDocuments(accessToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validSubmission);

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validSubmission);

      expect(res.status).toBe(400);
    });

    it('rejects without a valid access token', async () => {
      await request(app).post('/api/kyc/submit').send(validSubmission).expect(401);
    });

    it('rejects a customer with 403', async () => {
      const accessToken = await registerAsCustomer('customer2@example.com');

      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validSubmission);

      expect(res.status).toBe(403);
    });
  });

  describe('Admin review', () => {
    it('lists pending submissions for an admin', async () => {
      const userToken = await registerAndLogin('user6@example.com');
      await verifyDocuments(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validSubmission);
      const adminToken = await registerAdmin('admin1@example.com');

      const res = await request(app)
        .get('/api/admin/kyc')
        .query({ status: 'pending' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.records).toHaveLength(1);
      expect(res.body.data.records[0].status).toBe('pending');
    });

    it('rejects a non-admin from listing submissions with 403', async () => {
      const userToken = await registerAndLogin('user7@example.com');

      const res = await request(app)
        .get('/api/admin/kyc')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('rejects listing without a valid access token', async () => {
      await request(app).get('/api/admin/kyc').expect(401);
    });

    it('approves a pending submission', async () => {
      const userToken = await registerAndLogin('user8@example.com');
      await verifyDocuments(userToken);
      const submitRes = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validSubmission);
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin2@example.com');

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('verified');
      expect(submitRes.body.data.status).toBe('pending');

      const statusAfter = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(statusAfter.body.data.status).toBe('verified');
    });

    it('rejects a pending submission with a reason', async () => {
      const userToken = await registerAndLogin('user9@example.com');
      await verifyDocuments(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validSubmission);
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin3@example.com');

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Aadhar photo is blurry' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('rejected');
      expect(res.body.data.rejectionReason).toBe('Aadhar photo is blurry');

      const statusAfter = await request(app)
        .get('/api/kyc/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(statusAfter.body.data.status).toBe('rejected');
      expect(statusAfter.body.data.rejectionReason).toBe('Aadhar photo is blurry');
    });

    it('rejects reject without a reason, with 422', async () => {
      const userToken = await registerAndLogin('user10@example.com');
      await verifyDocuments(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validSubmission);
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin4@example.com');

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(422);
    });

    it('allows resubmission after rejection, clearing the rejection reason', async () => {
      const userToken = await registerAndLogin('user11@example.com');
      await verifyDocuments(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validSubmission);
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin5@example.com');
      await request(app)
        .patch(`/api/admin/kyc/${userId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'blurry' });

      const resubmit = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validSubmission);

      expect(resubmit.status).toBe(200);
      expect(resubmit.body.data.status).toBe('pending');
      expect(resubmit.body.data.rejectionReason).toBeUndefined();
    });

    it('rejects approving a submission that is not pending, with 400', async () => {
      const userToken = await registerAndLogin('user12@example.com');
      await verifyDocuments(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validSubmission);
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin6@example.com');
      await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('returns 404 when approving a user with no submission', async () => {
      const userToken = await registerAndLogin('user13@example.com');
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;
      const adminToken = await registerAdmin('admin7@example.com');

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('rejects a non-admin from approving with 403', async () => {
      const userToken = await registerAndLogin('user14@example.com');
      await verifyDocuments(userToken);
      await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validSubmission);
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      const userId = me.body.data.user.id;

      const res = await request(app)
        .patch(`/api/admin/kyc/${userId}/approve`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('rejects an invalid userId path param with 422', async () => {
      const adminToken = await registerAdmin('admin8@example.com');

      const res = await request(app)
        .patch('/api/admin/kyc/not-a-valid-id/approve')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
    });
  });
});
