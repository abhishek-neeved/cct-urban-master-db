import { and, eq, gt } from 'drizzle-orm';
import { refreshTokensTable } from '@nvcct/db-entities';
import { db } from '@shared/config/database';

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
 * tokens. Expired tokens are periodically swept by a `pg_cron` job defined in
 * `@nvcct/db-entities`'s migrations; correctness never depends on that sweep
 * having run, since every lookup here filters `expiresAt > now()` itself.
 */
export class RefreshTokenRepository implements IRefreshTokenRepository {
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await db.insert(refreshTokensTable).values({ userId, tokenHash, expiresAt });
  }

  async findUserIdByValidHash(tokenHash: string): Promise<string | null> {
    const [row] = await db
      .select({ userId: refreshTokensTable.userId })
      .from(refreshTokensTable)
      .where(
        and(
          eq(refreshTokensTable.tokenHash, tokenHash),
          gt(refreshTokensTable.expiresAt, new Date())
        )
      )
      .limit(1);
    return row ? row.userId : null;
  }

  async consumeByValidHash(tokenHash: string): Promise<string | null> {
    // A single atomic DELETE ... RETURNING — the Postgres equivalent of
    // Mongoose's findOneAndDelete, giving the same single-winner guarantee
    // under two concurrent refreshes racing on the same token.
    const [row] = await db
      .delete(refreshTokensTable)
      .where(
        and(
          eq(refreshTokensTable.tokenHash, tokenHash),
          gt(refreshTokensTable.expiresAt, new Date())
        )
      )
      .returning({ userId: refreshTokensTable.userId });
    return row ? row.userId : null;
  }

  async deleteByHash(tokenHash: string): Promise<void> {
    await db.delete(refreshTokensTable).where(eq(refreshTokensTable.tokenHash, tokenHash));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await db.delete(refreshTokensTable).where(eq(refreshTokensTable.userId, userId));
  }
}
