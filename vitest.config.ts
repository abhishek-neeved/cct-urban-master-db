import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Mirror the tsconfig path aliases. Defined explicitly (rather than via
// vite-tsconfig-paths) because the test files are excluded from tsconfig, which
// the plugin honors — so it wouldn't map aliases inside specs.
const alias = [
  { find: '@modules', replacement: r('./src/modules') },
  { find: '@shared', replacement: r('./src/shared') },
  { find: '@config', replacement: r('./src/shared/config') },
  { find: '@models', replacement: r('./src/shared/models') },
  { find: '@utils', replacement: r('./src/shared/utils') },
  { find: '@middleware', replacement: r('./src/shared/middleware') },
  { find: '@routes', replacement: r('./src/routes') },
  // Regex so it only matches the bare "@/..." root alias, never scoped packages.
  { find: /^@\//, replacement: `${r('./src')}/` },
];

// Integration/e2e specs each spin up their own in-memory MongoDB
// (mongodb-memory-server); run those files serially (mirrors the old jest
// `--runInBand`) so parallel instances don't thrash. Unit tests stay parallel.
const serial = { fileParallelism: false };

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    testTimeout: 30_000, // starting mongodb-memory-server's mongod binary takes a moment
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: { name: 'integration', include: ['tests/integration/**/*.spec.ts'], ...serial },
      },
      {
        extends: true,
        test: { name: 'e2e', include: ['tests/e2e/**/*.spec.ts'], ...serial },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Bootstrap/wiring with no branching logic to assert on.
      exclude: ['src/server.ts', 'src/**/*.d.ts', 'src/shared/types/**'],
      // Enforce full coverage: `pnpm test:coverage` (and CI) fail if any metric
      // regresses. New code must ship with tests — that's the gate.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
