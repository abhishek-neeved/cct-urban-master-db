import path from 'node:path';
import postgres from 'postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { env } from '@config/env';
import { logger } from '@utils/logger';

const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '..', '..', 'drizzle');
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';
const QUALIFIED_TABLE = `"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`;

/**
 * One-time adoption step for a database whose schema was already applied by
 * some other means (e.g. by hand, before `db:migrate` existed) — marks every
 * migration currently in `drizzle/` as already applied, WITHOUT running their
 * SQL, using the exact same hash `db:migrate` itself computes
 * (`readMigrationFiles`) so it recognizes them as done afterwards.
 *
 * Refuses to run if the tracking table already has rows — this is meant for
 * a one-time baseline, not routine use. A database that's never had its
 * schema applied at all should use `db:migrate` directly instead.
 */
const run = async (): Promise<void> => {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const client = postgres(env.DATABASE_URL, { max: 1, prepare: false });

  try {
    await client.unsafe(`create schema if not exists "${MIGRATIONS_SCHEMA}"`);
    await client.unsafe(`
      create table if not exists ${QUALIFIED_TABLE} (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `);

    const [{ count: alreadyBaselined }] = await client.unsafe<[{ count: number }]>(
      `select count(*)::int as count from ${QUALIFIED_TABLE}`
    );
    if (alreadyBaselined > 0) {
      throw new Error(
        `${QUALIFIED_TABLE} already has ${alreadyBaselined} row(s) — this database has ` +
          'already been baselined (or migrated normally). Refusing to re-baseline; ' +
          'use db:migrate for anything new instead.'
      );
    }

    for (const migration of migrations) {
      await client.unsafe(`insert into ${QUALIFIED_TABLE} (hash, created_at) values ($1, $2)`, [
        migration.hash,
        migration.folderMillis,
      ]);
    }
    logger.info(
      `✅ Marked ${migrations.length} migration(s) as already applied (baseline only — no SQL executed)`
    );
  } finally {
    await client.end();
  }
};

run().catch((err) => {
  logger.error(err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
