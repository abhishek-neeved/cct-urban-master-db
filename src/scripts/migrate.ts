import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { env } from '@config/env';
import { logger } from '@utils/logger';

/** This repo's own migrations folder — see `db:sync-migrations`. Never reaches
 * into `node_modules/@nvcct/db-entities` at runtime. */
const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '..', '..', 'drizzle');
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';
const QUALIFIED_TABLE = `"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`;

/**
 * Arbitrary fixed key for this app's migration advisory lock. Must stay
 * stable across deploys — two different keys would let concurrent instances
 * both believe they hold "the" lock.
 */
const MIGRATION_LOCK_KEY = 87_346_129;

/**
 * Applies every not-yet-applied SQL file from this repo's own `drizzle/`
 * folder, tracked in `drizzle.__drizzle_migrations` — so re-running this is a
 * no-op for anything already applied, and only new migrations (e.g. after
 * `db:sync-migrations` pulls in a bump of `@nvcct/db-entities`) actually run.
 * Uses its own single-connection client, separate from the app's shared pool
 * (`@config/database`).
 *
 * This deliberately does NOT use drizzle-orm's built-in migrator: that
 * acquires a SESSION-level advisory lock (`pg_advisory_lock`), which is
 * unsafe against `DATABASE_URL`s that go through a PgBouncer transaction-mode
 * pooler (Supabase's pooled connection string) — the pooler can hand
 * different statements to different physical backends between queries, so a
 * lock tied to one backend session can silently stop being held partway
 * through. Instead, acquiring the lock, checking what's pending, and applying
 * it all happen inside ONE transaction using `pg_advisory_xact_lock`, which
 * pins a single physical backend for the whole transaction (safe under
 * transaction-mode pooling) and releases automatically at commit/rollback —
 * no explicit unlock, and no way to leak the lock on a crash. In a
 * multi-instance deployment, every other instance simply blocks on that
 * `select pg_advisory_xact_lock(...)` until the first one commits, then finds
 * everything already applied and returns immediately.
 *
 * Note: `0002_pg_cron_expired_cleanup.sql` requires the `pg_cron` extension —
 * available on Supabase (or the Supabase CLI's local dev stack), not a bare
 * Postgres container. This runs on every boot with no special-casing, so a
 * bare local Postgres will fail here — use a Supabase-backed `DATABASE_URL`.
 */
export const runMigrations = async (): Promise<void> => {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const client = postgres(env.DATABASE_URL, { max: 1, prepare: false });

  try {
    await client.begin(async (tx) => {
      logger.info('Acquiring migration lock…');
      await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;

      await tx.unsafe(`create schema if not exists "${MIGRATIONS_SCHEMA}"`);
      await tx.unsafe(`
        create table if not exists ${QUALIFIED_TABLE} (
          id serial primary key,
          hash text not null,
          created_at bigint
        )
      `);

      const [lastApplied] = await tx.unsafe<[{ created_at: string | null }]>(
        `select created_at from ${QUALIFIED_TABLE} order by created_at desc limit 1`
      );
      const lastAppliedMillis = lastApplied ? Number(lastApplied.created_at) : null;

      let applied = 0;
      for (const migration of migrations) {
        if (lastAppliedMillis !== null && migration.folderMillis <= lastAppliedMillis) continue;

        logger.info(`Applying migration dated ${new Date(migration.folderMillis).toISOString()}…`);
        for (const statement of migration.sql) {
          await tx.unsafe(statement);
        }
        await tx.unsafe(`insert into ${QUALIFIED_TABLE} (hash, created_at) values ($1, $2)`, [
          migration.hash,
          migration.folderMillis,
        ]);
        applied++;
      }
      logger.info(applied > 0 ? `✅ Applied ${applied} migration(s)` : '✅ Already up to date');
    });
  } finally {
    await client.end();
  }
};

// Runnable directly (`pnpm db:migrate`) as well as imported by server.ts on boot.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runMigrations().catch((err) => {
    logger.error(err instanceof Error ? err : new Error(String(err)));
    process.exit(1);
  });
}
