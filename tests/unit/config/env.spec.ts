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

  it('accepts a correctly configured production environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(40));
    vi.stubEnv('CORS_ORIGINS', 'https://app.example.com');
    const { env, isProduction } = await loadEnv();
    expect(isProduction).toBe(true);
    expect(env.NODE_ENV).toBe('production');
  });
});
