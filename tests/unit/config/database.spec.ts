import { vi } from 'vitest';

// A dependency-free fake of the bits of mongoose this module touches: a
// `connect`/`disconnect` pair and a `connection.readyState` this module reads
// to report connectivity.
const mocks = vi.hoisted(() => {
  const connection = { readyState: 0 };
  const connect = vi.fn(async () => {
    connection.readyState = 1;
  });
  const disconnect = vi.fn(async () => {
    connection.readyState = 0;
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { connection, connect, disconnect, logger };
});

vi.mock('mongoose', () => ({
  default: { connect: mocks.connect, disconnect: mocks.disconnect, connection: mocks.connection },
}));
vi.mock('@utils/logger', () => ({ logger: mocks.logger }));

const { connectDatabase, disconnectDatabase, isDatabaseConnected } =
  await import('@config/database');

describe('database config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.readyState = 0;
  });

  it('connects and logs success', async () => {
    await connectDatabase('mongodb://example/db');

    expect(mocks.connect).toHaveBeenCalledWith('mongodb://example/db');
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('Connected to MongoDB'));
  });

  it('reports connection state before and after connecting', async () => {
    expect(isDatabaseConnected()).toBe(false);
    await connectDatabase('mongodb://example/db');
    expect(isDatabaseConnected()).toBe(true);
  });

  it('disconnects and logs closure', async () => {
    await connectDatabase('mongodb://example/db');
    await disconnectDatabase();

    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('connection closed'));
    expect(isDatabaseConnected()).toBe(false);
  });
});
