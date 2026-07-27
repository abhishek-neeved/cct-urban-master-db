import { cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@utils/logger';

/**
 * Copies `@nvcct/db-entities`' migration files into this repo's own
 * `drizzle/` folder, so migrations are versioned and reviewable in this
 * repo's git history and applied (`db:migrate`) from a fixed local path —
 * never by reaching into `node_modules` at runtime.
 *
 * Run this after bumping `@nvcct/db-entities` to a version with new
 * migrations, review the resulting diff under `drizzle/`, and commit it.
 */
const run = async (): Promise<void> => {
  const packageJsonUrl = import.meta.resolve('@nvcct/db-entities/package.json');
  const source = path.join(path.dirname(fileURLToPath(packageJsonUrl)), 'drizzle');
  const destination = path.join(import.meta.dirname, '..', '..', 'drizzle');

  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });

  const files = await readdir(destination);
  logger.info(`Synced ${files.length} entries from @nvcct/db-entities into ${destination}`);
};

run().catch((err) => {
  logger.error(err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
