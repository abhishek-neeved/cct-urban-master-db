import crypto from 'node:crypto';
import { REFRESH_TOKEN_REUSE_GRACE_MS } from '@config/constants';
import { RefreshTokenModel } from './auth.model';

/**
 * Outcome of `rotate()`:
 * - `rotated`   — the presented token was valid and unused; a new token in the
 *                 same family has been stored.
 * - `reused`    — the presented token had already been rotated out once before
 *                 (replay). Every token in its family has just been revoked —
 *                 the caller should force the owning user to log in again.
 * - `invalid`   — the token is unknown or naturally expired; not a replay.
 */
export type RotateResult =
  | { status: 'rotated'; userId: string }
  | { status: 'reused'; userId: string }
  | { status: 'invalid' };

export interface IRefreshTokenRepository {
  /** Issue the first token of a brand-new session (login) — starts a new family. */
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /**
   * Atomically rotate a presented refresh token to a new one in the same
   * family. See `RotateResult` for the three possible outcomes.
   */
  rotate(oldTokenHash: string, newTokenHash: string, newExpiresAt: Date): Promise<RotateResult>;
  deleteByHash(tokenHash: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

/**
 * Stores refresh tokens by SHA-256 hash so a stolen DB never yields usable
 * tokens. Not built on `BaseRepository` — its query shape (hash lookups,
 * atomic rotation, family revocation) doesn't fit the generic id-keyed CRUD
 * surface.
 *
 * Rotation with reuse detection: every token issued from one login shares a
 * `familyId`. Rotating a token doesn't delete it — it's stamped `usedAt` and a
 * new token in the same family is stored. If a token is ever presented a
 * second time (its `usedAt` is already set), that can only happen if it was
 * copied by an attacker before the legitimate client rotated it — so the
 * entire family is revoked, invalidating the thief's and the legitimate
 * client's sessions alike and forcing a fresh login.
 */
export class RefreshTokenRepository implements IRefreshTokenRepository {
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await RefreshTokenModel.create({
      userId,
      tokenHash,
      expiresAt,
      familyId: crypto.randomUUID(),
      usedAt: null,
    });
  }

  async rotate(
    oldTokenHash: string,
    newTokenHash: string,
    newExpiresAt: Date
  ): Promise<RotateResult> {
    const now = new Date();

    // Atomic claim: only one concurrent caller can flip `usedAt` null -> now
    // for a still-valid token, preserving the single-winner guarantee under
    // races (mirrors the previous findOneAndDelete-based rotation).
    const claimed = await RefreshTokenModel.findOneAndUpdate(
      { tokenHash: oldTokenHash, usedAt: null, expiresAt: { $gt: now } },
      { usedAt: now }
    ).lean();

    if (claimed) {
      await RefreshTokenModel.create({
        userId: claimed.userId,
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt,
        familyId: claimed.familyId,
        usedAt: null,
      });
      return { status: 'rotated', userId: String(claimed.userId) };
    }

    // Not claimable — work out why, to tell a replay (theft signal) apart
    // from a token that's merely unknown or has naturally expired.
    const existing = await RefreshTokenModel.findOne({ tokenHash: oldTokenHash }).lean();
    if (!existing) {
      return { status: 'invalid' };
    }
    if (existing.usedAt) {
      const withinGraceWindow =
        now.getTime() - existing.usedAt.getTime() <= REFRESH_TOKEN_REUSE_GRACE_MS;
      if (withinGraceWindow) {
        // Almost certainly a benign race against the request that won the
        // rotation a moment ago, not a stale-token replay — reject this one
        // request without treating it as a theft signal.
        return { status: 'invalid' };
      }
      await RefreshTokenModel.deleteMany({ familyId: existing.familyId });
      return { status: 'reused', userId: String(existing.userId) };
    }
    return { status: 'invalid' };
  }

  async deleteByHash(tokenHash: string): Promise<void> {
    await RefreshTokenModel.deleteOne({ tokenHash });
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await RefreshTokenModel.deleteMany({ userId });
  }
}
