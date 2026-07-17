import request from 'supertest';
import { Application } from 'express';
import { createApp } from '@/app';
import { BlockchainRepository } from '@modules/blockchain/blockchain.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../helpers/db';

const credentials = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  password: 'supersecret',
};

describe('Blockchains API (e2e)', () => {
  let app: Application;

  beforeAll(async () => {
    await connectTestDb();
    app = createApp();
  });
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  // Read-only endpoint — no POST route to seed through, so seed the
  // repository directly (same in-memory Postgres the app is wired to).
  const seed = async () => {
    const repository = new BlockchainRepository();
    await Promise.all([
      repository.create({ name: 'Ethereum', symbol: 'ETH', chainType: 'evm', isTestnet: false }),
      repository.create({ name: 'Solana', symbol: 'SOL', chainType: 'solana', isTestnet: false }),
    ]);
  };

  /** Registers, verifies, and logs in a fresh account; returns both auth mechanisms. */
  const login = async (): Promise<{ accessToken: string; cookie: string }> => {
    const registerRes = await request(app).post('/api/auth/register').send(credentials);
    await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: credentials.email, otp: registerRes.body.data.otpDevCode });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    return {
      accessToken: loginRes.body.data.accessToken,
      cookie: loginRes.headers['set-cookie'][0],
    };
  };

  it('requires authentication', async () => {
    await request(app).get('/api/blockchains').expect(401);
  });

  it('lists blockchains, paginated, for an authenticated caller', async () => {
    await seed();
    const { accessToken } = await login();

    const res = await request(app)
      .get('/api/blockchains')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
    expect(res.body.data.meta).toMatchObject({ page: 1, limit: 10, total: 2 });
  });

  it('accepts the accessToken cookie instead of a Bearer header', async () => {
    await seed();
    const { cookie } = await login();

    const res = await request(app).get('/api/blockchains').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
  });

  it('searches by name/symbol and paginates', async () => {
    await seed();
    const { accessToken } = await login();
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${accessToken}`);

    const bySearch = await auth(request(app).get('/api/blockchains').query({ search: 'sol' }));
    expect(bySearch.body.data.data.map((b: { name: string }) => b.name)).toEqual(['Solana']);

    const byChainType = await auth(
      request(app).get('/api/blockchains').query({ chainType: 'evm' })
    );
    expect(byChainType.body.data.data.map((b: { name: string }) => b.name)).toEqual(['Ethereum']);

    const paged = await auth(request(app).get('/api/blockchains').query({ page: 1, limit: 1 }));
    expect(paged.body.data.data).toHaveLength(1);
    expect(paged.body.data.meta).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it('rejects an invalid query with 422', async () => {
    await seed();
    const { accessToken } = await login();

    const res = await request(app)
      .get('/api/blockchains')
      .query({ chainType: 'not-a-real-chain' })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(422);
  });
});
