import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@nvcct/db-entities';
import { env } from './env';
import { logger } from '@utils/logger';

type AppDatabase = PostgresJsDatabase<typeof schema>;

let client: postgres.Sql | null = null;
let dbInstance: AppDatabase | null = null;

/**
 * Opens the shared postgres.js connection pool and the Drizzle instance
 * repositories use. Must be established before the server starts accepting
 * requests.
 */
export const connectDatabase = async (
  connectionString: string = env.DATABASE_URL
): Promise<void> => {
  client = postgres(connectionString, {
    // Supabase's pooled connection (port 6543, pgbouncer transaction mode)
    // doesn't support server-side prepared statements.
    prepare: false,
  });
  dbInstance = drizzle(client, { schema });

  // Fail fast at boot instead of hanging; the process exits and the
  // orchestrator (k8s/systemd/docker) restarts it until Postgres is ready.
  await client`select 1`;
  logger.info('✅ Connected to Postgres');
};

export const disconnectDatabase = async (): Promise<void> => {
  await client?.end();
  client = null;
  dbInstance = null;
  logger.info('Postgres connection closed');
};

/**
 * Whether a usable database instance is currently established. Checks
 * `dbInstance`, not `client` — tests swap in a pglite instance via
 * `setDbInstance` without ever creating a real postgres.js `client`.
 */
export const isDatabaseConnected = (): boolean => dbInstance !== null;

/** Test-only seam: swap the shared instance for a test double (e.g. pglite). */
export const setDbInstance = (instance: AppDatabase): void => {
  dbInstance = instance;
};

/**
 * The shared Drizzle instance repositories query through. Repositories import
 * this at module-eval time, before `connectDatabase()` runs at boot, so it's
 * a proxy over the lazily-created real instance rather than the instance
 * itself.
 */
export const db: AppDatabase = new Proxy({} as AppDatabase, {
  get(_target, prop) {
    if (!dbInstance) throw new Error('Database not connected — call connectDatabase() first');
    return dbInstance[prop as keyof AppDatabase];
  },
});
