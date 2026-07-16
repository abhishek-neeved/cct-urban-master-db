import { vi } from 'vitest';

// A dependency-free fake of the bits of postgres.js/drizzle this module
// touches: a callable client (with `.end()`) standing in for the tagged-
// template `postgres()` client, and a `drizzle()` factory.
const mocks = vi.hoisted(() => {
  const clientFn = vi.fn(async () => []);
  const end = vi.fn().mockResolvedValue(undefined);
  const client = Object.assign(clientFn, { end });
  const postgresFactory = vi.fn(() => client);
  const drizzleFn = vi.fn(() => ({}));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { client, postgresFactory, drizzleFn, logger };
});

vi.mock('postgres', () => ({ default: mocks.postgresFactory }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: mocks.drizzleFn }));
vi.mock('@nvcct/db-entities', () => ({}));
vi.mock('@utils/logger', () => ({ logger: mocks.logger }));

const { connectDatabase, disconnectDatabase, isDatabaseConnected, db } =
  await import('@config/database');

describe('database config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Reset real module state (client/dbInstance) between tests, not just mock
    // call counts — connectDatabase/disconnectDatabase mutate module-level state.
    await disconnectDatabase();
  });

  it('connects with prepared statements disabled, runs a health check, and logs success', async () => {
    await connectDatabase('postgresql://example/db');

    expect(mocks.postgresFactory).toHaveBeenCalledWith(
      'postgresql://example/db',
      expect.objectContaining({ prepare: false })
    );
    expect(mocks.client).toHaveBeenCalled(); // the `select 1` health-check call
    expect(mocks.drizzleFn).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({ schema: expect.anything() })
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Connected to Postgres')
    );
  });

  it('reports connection state before and after connecting', async () => {
    expect(isDatabaseConnected()).toBe(false);
    await connectDatabase('postgresql://example/db');
    expect(isDatabaseConnected()).toBe(true);
  });

  it('disconnects, ends the client, and logs closure', async () => {
    await connectDatabase('postgresql://example/db');
    await disconnectDatabase();

    expect(mocks.client.end).toHaveBeenCalledTimes(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('connection closed'));
    expect(isDatabaseConnected()).toBe(false);
  });

  it('disconnecting without a prior connection is a no-op', async () => {
    await disconnectDatabase();
    expect(mocks.client.end).not.toHaveBeenCalled();
  });

  it('throws from the shared db instance when queried before connecting', () => {
    expect(() => db.select).toThrow('Database not connected — call connectDatabase() first');
  });

  it('routes property access through to the real instance once connected', async () => {
    const fakeInstance = { select: vi.fn() };
    mocks.drizzleFn.mockReturnValueOnce(fakeInstance);

    await connectDatabase('postgresql://example/db');

    expect(db.select).toBe(fakeInstance.select);
  });
});
