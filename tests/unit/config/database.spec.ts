import { vi } from 'vitest';

// A dependency-free fake of the bits of the Mongoose connection the module
// touches: an event registry (on/emit/listenerCount) plus a settable readyState.
const mocks = vi.hoisted(() => {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const connection = {
    readyState: 0,
    name: 'db',
    host: 'example',
    port: 27017,
    listenerCount: (event: string) => listeners[event]?.length ?? 0,
    on(event: string, cb: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(cb);
      return connection;
    },
    emit(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach((cb) => cb(...args));
    },
  };
  const mongoose = {
    set: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    version: '9.0.0',
    connection,
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { connection, mongoose, logger };
});

vi.mock('mongoose', () => ({ default: mocks.mongoose }));
vi.mock('@utils/logger', () => ({ logger: mocks.logger }));

const { connectDatabase, disconnectDatabase, isDatabaseConnected } =
  await import('@config/database');

describe('database config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.readyState = 0;
  });

  it('connects with a fail-fast timeout, pins strictQuery, and logs success', async () => {
    await connectDatabase('mongodb://example/db');

    expect(mocks.mongoose.set).toHaveBeenCalledWith('strictQuery', true);
    expect(mocks.mongoose.connect).toHaveBeenCalledWith(
      'mongodb://example/db',
      expect.objectContaining({ serverSelectionTimeoutMS: 10_000 })
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Connected to MongoDB'),
      expect.objectContaining({ database: 'db', host: 'example', port: 27017 })
    );
  });

  it('registers connection listeners once, even across repeated connects', async () => {
    await connectDatabase('mongodb://example/db');
    await connectDatabase('mongodb://example/db');
    expect(mocks.connection.listenerCount('error')).toBe(1);
    expect(mocks.connection.listenerCount('disconnected')).toBe(1);
    expect(mocks.connection.listenerCount('reconnected')).toBe(1);
  });

  it('routes post-connect connection events to the logger', async () => {
    await connectDatabase('mongodb://example/db');

    const err = new Error('connection dropped');
    mocks.connection.emit('error', err);
    mocks.connection.emit('disconnected');
    mocks.connection.emit('reconnected');

    expect(mocks.logger.error).toHaveBeenCalledWith(err);
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('reconnected'));
  });

  it('reports connection state from readyState', () => {
    mocks.connection.readyState = 1;
    expect(isDatabaseConnected()).toBe(true);
    mocks.connection.readyState = 0;
    expect(isDatabaseConnected()).toBe(false);
  });

  it('disconnects and logs closure', async () => {
    await disconnectDatabase();
    expect(mocks.mongoose.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('connection closed'));
  });
});
