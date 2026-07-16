import crypto from 'node:crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '@config/env';
import { OTP_LENGTH } from '@config/constants';

export interface AccessTokenPayload {
  sub: string;
}

/** We only ever sign/verify with HMAC-SHA256; pin it to avoid algorithm confusion. */
const JWT_ALGORITHM = 'HS256' as const;

/** Sign a short-lived access JWT for a user id. */
export const signAccessToken = (userId: string): string => {
  const options: SignOptions = {
    algorithm: JWT_ALGORITHM,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, options);
};

/** Verify an access JWT and return its payload. Throws if invalid/expired. */
export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [JWT_ALGORITHM] });
  return { sub: typeof decoded === 'string' ? decoded : String(decoded.sub) };
};

/**
 * Generate a cryptographically-random opaque token (hex). Used for refresh and
 * password-reset tokens — the raw value goes to the client, only its hash is
 * persisted.
 */
export const generateOpaqueToken = (bytes = 48): string =>
  crypto.randomBytes(bytes).toString('hex');

/** SHA-256 hash of a token, for at-rest storage/lookup. */
export const hashToken = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

/**
 * Generate a zero-padded, cryptographically-random numeric OTP (e.g. "042317").
 * `crypto.randomInt` is unbiased over the range. The raw code is emailed to the
 * user; only its `hashToken` hash is persisted.
 */
export const generateNumericOtp = (digits = OTP_LENGTH): string => {
  const max = 10 ** digits;
  return crypto.randomInt(0, max).toString().padStart(digits, '0');
};
