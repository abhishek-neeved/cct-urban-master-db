import { Server } from 'node:http';
import { createApp } from './app';
import { env } from '@config/env';
import { connectDatabase, disconnectDatabase } from '@config/database';
import { logger } from '@utils/logger';

const start = async (): Promise<void> => {
  await connectDatabase();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    // Link to where the process actually listens, so the URL is always
    // clickable locally regardless of the public APP_URL (proxy/base URL).
    const baseUrl = `http://localhost:${env.PORT}`;
    logger.info(`🚀 Server listening on port ${env.PORT} (${env.NODE_ENV})`);
    logger.info(`📚 Swagger UI:   ${baseUrl}/api/docs`);
    logger.info(`📄 OpenAPI JSON: ${baseUrl}/api/docs.json`);
  });

  const shutdown = (signal: string): void => {
    logger.info(`${signal} received, shutting down gracefully`);
    server.close(async () => {
      await disconnectDatabase();
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

process.on('unhandledRejection', (reason) => {
  logger.error(reason instanceof Error ? reason : new Error(String(reason)));
});

start().catch((err) => {
  logger.error(err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
