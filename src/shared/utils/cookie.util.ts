import { Response } from 'express';
import { env, isProduction } from '@config/env';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@config/constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shared-utils layer must not depend on feature modules — kept structurally
 * compatible with `AuthTokens` (`@modules/auth/auth.service`) instead. */
export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Shared cookie flags: httpOnly (no JS access), secure in production (browsers
 * refuse `Secure` cookies over plain HTTP, so dev/test stay non-secure),
 * `SameSite=None` in production to allow a cross-origin frontend (paired with
 * `credentials: true` in `@middleware/cors`), `Lax` locally where that
 * cross-site round trip usually isn't needed. Computed per call (not once at
 * module load) so it always reflects the current `isProduction`.
 */
const baseCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? ('none' as const) : ('lax' as const),
});

/**
 * Mirrors both tokens into httpOnly cookies alongside the JSON response body,
 * so callers can authenticate via either mechanism (browser clients via the
 * cookie, non-browser clients via the returned tokens).
 */
export const setAuthCookies = (res: Response, tokens: AuthTokenPair): void => {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, baseCookieOptions());
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions(),
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
  });
};

/** Clears both auth cookies (logout). Flags must match those used to set them. */
export const clearAuthCookies = (res: Response): void => {
  res.clearCookie(ACCESS_TOKEN_COOKIE, baseCookieOptions());
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions());
};
