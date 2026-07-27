import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { pushSchema } from 'drizzle-kit/api';
import * as schema from '@nvcct/db-entities';
import { db, setDbInstance } from '@config/database';

let pglite: PGlite | null = null;

/**
 * `pushSchema` only creates tables/columns from the TS schema — it knows
 * nothing about the hand-authored SQL migrations (triggers) that live
 * alongside it in @nvcct/db-entities' `drizzle/` folder. Apply those
 * directly so pglite behaves like the real database. Skips `0000_*`
 * (redundant with pushSchema) and the Supabase-only `pg_cron` migration
 * (the extension isn't available here).
 */
const applyHandAuthoredMigrations = async (instance: PGlite): Promise<void> => {
  const packageJsonUrl = import.meta.resolve('@nvcct/db-entities/package.json');
  const migrationsDir = path.join(path.dirname(fileURLToPath(packageJsonUrl)), 'drizzle');
  const files = (await readdir(migrationsDir))
    .filter(
      (file) => file.endsWith('.sql') && !file.startsWith('0000_') && !file.includes('pg_cron')
    )
    .sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await instance.exec(sql);
  }
};

/** Spin up an isolated in-memory Postgres (WASM) and push the schema into it. */
export const connectTestDb = async (): Promise<void> => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  const { apply } = await pushSchema(schema, testDb);
  await apply();
  await applyHandAuthoredMigrations(pglite);
  // pglite's query-builder surface is structurally identical to postgres.js's
  // for the select/insert/update/delete API this app uses — only the
  // underlying driver differs.
  setDbInstance(testDb as unknown as Parameters<typeof setDbInstance>[0]);
};

/** Wipe every table between tests so each case starts clean (children first, FK-safe). */
export const clearTestDb = async (): Promise<void> => {
  await db.delete(schema.refreshTokensTable);
  await db.delete(schema.otpsTable);
  await db.delete(schema.usersTable);
};

/** Tear down the connection. */
export const closeTestDb = async (): Promise<void> => {
  await pglite?.close();
  pglite = null;
};
