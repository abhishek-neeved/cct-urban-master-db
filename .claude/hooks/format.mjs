#!/usr/bin/env node
/**
 * PostToolUse hook: auto-format an edited TypeScript file with Prettier.
 *
 * Reads the hook payload (JSON) from stdin, pulls out the edited file path,
 * and runs the project-local Prettier on it if it's a .ts/.tsx file.
 *
 * Prettier is invoked via its JS entry with `node` (no shell), so paths that
 * contain spaces — like this project's — are passed safely as an argv element.
 * Designed to never block an edit: any error just exits 0 silently.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const readStdin = () =>
  new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });

const main = async () => {
  const raw = await readStdin();

  let file;
  try {
    const payload = JSON.parse(raw || '{}');
    file = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath;
  } catch {
    process.exit(0);
  }

  if (!file || !/\.(ts|tsx)$/.test(file)) process.exit(0);

  let prettierBin;
  try {
    // Resolve the project-local Prettier CLI entry (./bin/prettier.cjs).
    prettierBin = createRequire(import.meta.url).resolve('prettier/bin/prettier.cjs');
  } catch {
    process.exit(0); // Prettier not installed — don't block.
  }

  spawnSync(process.execPath, [prettierBin, '--write', '--ignore-unknown', file], {
    stdio: 'ignore',
  });

  process.exit(0);
};

main();
