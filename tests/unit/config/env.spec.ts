import { vi } from 'vitest';

// env.ts validates process.env at import time, so each case re-imports it fresh
// under a stubbed environment.
const loadEnv = () => import('@config/env');

describe('env config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses defaults for a development environment', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { env, isProduction, isTest } = await loadEnv();
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(isProduction).toBe(false);
    expect(isTest).toBe(false);
  });

  it('loads a .env file when VITEST is not set (simulates a real process boot)', async () => {
    // '' is falsy, so `!process.env.VITEST` takes the branch a real (non-test)
    // process boot would take, exercising the dotenv.config() call. dotenv
    // writes straight into `process.env`, which `vi.unstubAllEnvs()` in
    // `afterEach` does NOT undo (it only reverts `vi.stubEnv` calls) — so any
    // var a developer's local .env happens to set (e.g. real Razorpay
    // credentials) would otherwise leak into every later test in this file.
    // Snapshot and restore the exact keys dotenv can touch to keep this test
    // hermetic regardless of what's in the machine's own .env.
    const keysDotenvMightSet = Object.keys(process.env);
    try {
      vi.stubEnv('VITEST', '');
      vi.stubEnv('NODE_ENV', 'development');
      await expect(loadEnv()).resolves.toBeDefined();
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!keysDotenvMightSet.includes(key)) {
          delete process.env[key];
        }
      }
    }
  });

  it('throws on an invalid environment (unknown NODE_ENV)', async () => {
    vi.stubEnv('NODE_ENV', 'banana');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadEnv()).rejects.toThrow('Invalid environment configuration');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('rejects a production boot that keeps the weak/default JWT secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_ACCESS_SECRET', 'too-short');
    vi.stubEnv('CORS_ORIGINS', 'https://app.example.com');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadEnv()).rejects.toThrow('Invalid environment configuration');
    errSpy.mockRestore();
  });

  it('rejects a production boot without a CORS allowlist', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(40));
    vi.stubEnv('CORS_ORIGINS', '   ,  ');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadEnv()).rejects.toThrow('Invalid environment configuration');
    errSpy.mockRestore();
  });

  const stubProductionRazorpay = (): void => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_live_real');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'a-real-secret');
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'a-real-webhook-secret');
    vi.stubEnv('MOBILE_VERIFICATION_API_KEY', 'a-real-mobile-verification-api-key');
  };

  it('accepts a correctly configured production environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(40));
    vi.stubEnv('CORS_ORIGINS', 'https://app.example.com');
    stubProductionRazorpay();
    const { env, isProduction } = await loadEnv();
    expect(isProduction).toBe(true);
    expect(env.NODE_ENV).toBe('production');
  });

  it('defaults S3 config for local dev without requiring credentials', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { env } = await loadEnv();
    expect(env.S3_BUCKET).toBe('cdma-uploads-dev');
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('rejects a custom S3 endpoint without static credentials (e.g. MinIO)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadEnv()).rejects.toThrow('Invalid environment configuration');
    errSpy.mockRestore();
  });

  it('accepts a custom S3 endpoint with static credentials', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'minioadmin');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'minioadmin');
    vi.stubEnv('S3_FORCE_PATH_STYLE', 'true');
    const { env } = await loadEnv();
    expect(env.S3_ENDPOINT).toBe('http://localhost:9000');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('defaults Razorpay config to dev placeholders outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { env } = await loadEnv();
    expect(env.RAZORPAY_KEY_ID).toBe('rzp_test_placeholder');
    expect(env.RAZORPAY_KEY_SECRET).toBe('dev-razorpay-secret-change-me');
  });

  it.each([
    ['RAZORPAY_KEY_ID', 'rzp_test_placeholder'],
    ['RAZORPAY_KEY_SECRET', 'dev-razorpay-secret-change-me'],
    ['RAZORPAY_WEBHOOK_SECRET', 'dev-webhook-secret-change-me'],
    ['MOBILE_VERIFICATION_API_KEY', 'mobile-verification-api-key-placeholder'],
  ])(
    'rejects a production boot that leaves %s at its dev placeholder',
    async (key, placeholder) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(40));
      vi.stubEnv('CORS_ORIGINS', 'https://app.example.com');
      stubProductionRazorpay();
      // Explicitly re-set just this one var back to its dev placeholder value —
      // stubProductionRazorpay() above already gave every var a real value, so
      // this isolates the one field the refine should catch.
      vi.stubEnv(key, placeholder);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(loadEnv()).rejects.toThrow('Invalid environment configuration');
      errSpy.mockRestore();
    }
  );
});
