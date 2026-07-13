import { RefreshTokenModel } from './refresh-token.model';

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
 * tokens. Expired tokens are also swept automatically by the TTL index on the
 * model.
 */
export class RefreshTokenRepository implements IRefreshTokenRepository {
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await RefreshTokenModel.create({ user: userId, tokenHash, expiresAt });
  }

  async findUserIdByValidHash(tokenHash: string): Promise<string | null> {
    const doc = await RefreshTokenModel.findOne({
      tokenHash,
      expiresAt: { $gt: new Date() },
    }).exec();
    return doc ? doc.user.toString() : null;
  }

  async consumeByValidHash(tokenHash: string): Promise<string | null> {
    const doc = await RefreshTokenModel.findOneAndDelete({
      tokenHash,
      expiresAt: { $gt: new Date() },
    }).exec();
    return doc ? doc.user.toString() : null;
  }

  async deleteByHash(tokenHash: string): Promise<void> {
    await RefreshTokenModel.deleteOne({ tokenHash }).exec();
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await RefreshTokenModel.deleteMany({ user: userId }).exec();
  }
}
