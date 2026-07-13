import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '@utils/logger';

/**
 * Opens the shared Mongoose connection. Repositories use this global connection,
 * so it must be established before the server starts accepting requests.
 */
export const connectDatabase = async (uri: string = env.MONGO_URI): Promise<void> => {
  mongoose.set('strictQuery', true);

  // Listeners for drops that happen AFTER the initial connect. Mongoose
  // auto-reconnects, but an unhandled 'error' event would otherwise crash the
  // process, so we attach handlers before connecting. Guard against double
  // registration in case connectDatabase is called more than once (e.g. tests).
  if (mongoose.connection.listenerCount('error') === 0) {
    mongoose.connection.on('error', (err) => logger.error(err));
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  }

  // Fail fast at boot instead of hanging on the 30s default; the process exits
  // and the orchestrator (k8s/systemd/docker) restarts it until Mongo is ready.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info('✅ Connected to MongoDB');
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  logger.info('MongoDB connection closed');
};

/**
 * Whether the shared Mongoose connection is currently established (readyState
 * 1 = connected). Lets upper layers report readiness without importing Mongoose.
 */
export const isDatabaseConnected = (): boolean => mongoose.connection.readyState === 1;
