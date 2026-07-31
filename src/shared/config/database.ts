import dns from 'node:dns';
import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '@utils/logger';

// Node's default resolver can end up pointed at a dead loopback/VPN stub
// (127.0.0.1) that refuses SRV queries even though the OS resolver works
// fine, breaking `mongodb+srv://` lookups. Force known-good DNS servers.
dns.setServers(['8.8.8.8', '1.1.1.1']);

/**
 * Opens the shared Mongoose connection repositories query through (models
 * attach to Mongoose's default connection automatically). Must be established
 * before the server starts accepting requests.
 */
export const connectDatabase = async (
  connectionString: string = env.DATABASE_URL
): Promise<void> => {
  await mongoose.connect(connectionString);
  logger.info('✅ Connected to MongoDB');
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  logger.info('MongoDB connection closed');
};

/**
 * Whether a usable database connection is currently established. Reads
 * Mongoose's own connection state (`readyState === 1`) rather than tracking a
 * separate flag, so it stays correct even if the connection drops
 * unexpectedly.
 */
export const isDatabaseConnected = (): boolean => mongoose.connection.readyState === 1;
