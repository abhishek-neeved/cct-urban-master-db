import { vi } from 'vitest';
import type { Response } from 'express';

// Mutable production flag, injected via a getter mock so both environment
// branches can be exercised in the same file (see email.service.spec.ts).
const state = vi.hoisted(() => ({ isProduction: false }));

vi.mock('@config/env', () => ({
  get isProduction() {
    return state.isProduction;
  },
  env: { REFRESH_TOKEN_TTL_DAYS: 7 },
}));

const { setAuthCookies, clearAuthCookies } = await import('@utils/cookie.util');

const mockRes = () =>
  ({
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  }) as unknown as Response;

describe('cookie.util', () => {
  const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1' };

  it('sets non-secure, SameSite=Lax cookies outside production', () => {
    state.isProduction = false;
    const res = mockRes();

    setAuthCookies(res, tokens);

    expect(res.cookie).toHaveBeenCalledWith(
      'accessToken',
      'access-1',
      expect.objectContaining({ httpOnly: true, secure: false, sameSite: 'lax' })
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'refresh-1',
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
    );
  });

  it('sets secure, SameSite=None cookies in production (cross-origin capable)', () => {
    state.isProduction = true;
    const res = mockRes();

    setAuthCookies(res, tokens);

    expect(res.cookie).toHaveBeenCalledWith(
      'accessToken',
      'access-1',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'none' })
    );
  });

  it('clears both cookies with matching flags', () => {
    state.isProduction = false;
    const res = mockRes();

    clearAuthCookies(res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'accessToken',
      expect.objectContaining({ httpOnly: true, secure: false, sameSite: 'lax' })
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.objectContaining({ httpOnly: true, secure: false, sameSite: 'lax' })
    );
  });
});
