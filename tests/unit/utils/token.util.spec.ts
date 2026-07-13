import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import {
  generateOpaqueToken,
  hashToken,
  signAccessToken,
  verifyAccessToken,
} from '@utils/token.util';

describe('token.util', () => {
  describe('access tokens', () => {
    it('signs a token whose payload round-trips through verify', () => {
      const token = signAccessToken('user-123');
      expect(verifyAccessToken(token)).toEqual({ sub: 'user-123' });
    });

    it('throws on a tampered/invalid token', () => {
      expect(() => verifyAccessToken('not.a.jwt')).toThrow();
    });

    it('coerces a string JWT payload into the sub field', () => {
      // A token whose payload is a raw string (not an object) exercises the
      // `typeof decoded === 'string'` branch in verifyAccessToken.
      const token = jwt.sign('raw-subject', env.JWT_ACCESS_SECRET, { algorithm: 'HS256' });
      expect(verifyAccessToken(token)).toEqual({ sub: 'raw-subject' });
    });
  });

  describe('opaque tokens', () => {
    it('generates a hex string of the requested byte length (default 48)', () => {
      expect(generateOpaqueToken()).toMatch(/^[0-9a-f]{96}$/);
      expect(generateOpaqueToken(16)).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates a different value each time', () => {
      expect(generateOpaqueToken()).not.toBe(generateOpaqueToken());
    });
  });

  describe('hashToken', () => {
    it('is a deterministic 64-char sha256 hex digest', () => {
      expect(hashToken('abc')).toBe(hashToken('abc'));
      expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
      expect(hashToken('abc')).not.toBe(hashToken('abd'));
    });
  });
});
