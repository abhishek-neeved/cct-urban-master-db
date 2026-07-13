import bcrypt from 'bcryptjs';
import { env } from '@config/env';

/** Hash a plaintext password using bcrypt. */
export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);

/** Constant-time compare of a plaintext password against a bcrypt hash. */
export const comparePassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

let dummyHash: string | undefined;

/**
 * A throwaway bcrypt hash (computed once, at the configured cost) to compare
 * against when an account doesn't exist, so login takes the same time whether
 * or not the email is registered — closing the timing side-channel.
 */
export const getDummyPasswordHash = async (): Promise<string> => {
  if (!dummyHash) {
    dummyHash = await bcrypt.hash('dummy-password-for-constant-time-login', env.BCRYPT_SALT_ROUNDS);
  }
  return dummyHash;
};
