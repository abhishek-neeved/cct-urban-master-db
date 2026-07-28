import { RefreshTokenModel } from './auth.model';

export interface IRefreshTokenRepository {
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findUserIdByValidHash(tokenHash: string): Promise<string | null>;
  /**
   * Atomically consume a valid (unexpired) token: find-and-delete in a single
   * operation, returning the owning user id only if THIS call won the delete.
   * Used by rotation so two concurrent refreshes with the same token can't both
   * succeed.
   */
  consumeByValidHash(tokenHash: string): Promise<string | null>;
  deleteByHash(tokenHash: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

/**
 * Stores refresh tokens by SHA-256 hash so a stolen DB never yields usable
 * tokens. Not built on `BaseRepository` — its query shape (hash lookups,
 * atomic find-and-delete) doesn't fit the generic id-keyed CRUD surface.
 */
export class RefreshTokenRepository implements IRefreshTokenRepository {
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await RefreshTokenModel.create({ userId, tokenHash, expiresAt });
  }

  async findUserIdByValidHash(tokenHash: string): Promise<string | null> {
    const doc = await RefreshTokenModel.findOne({
      tokenHash,
      expiresAt: { $gt: new Date() },
    }).lean();
    return doc ? String(doc.userId) : null;
  }

  async consumeByValidHash(tokenHash: string): Promise<string | null> {
    // A single atomic findOneAndDelete — the same operation two concurrent
    // refreshes race on, giving a single-winner guarantee under either.
    const doc = await RefreshTokenModel.findOneAndDelete({
      tokenHash,
      expiresAt: { $gt: new Date() },
    }).lean();
    return doc ? String(doc.userId) : null;
  }

  async deleteByHash(tokenHash: string): Promise<void> {
    await RefreshTokenModel.deleteOne({ tokenHash });
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await RefreshTokenModel.deleteMany({ userId });
  }
}
