import { and, eq, gt, sql } from 'drizzle-orm';
import { otpsTable } from '@nvcct/db-entities';
import { db } from '@shared/config/database';

/**
 * This repository only ever issues/consumes the account-verification flow, so
 * every query is scoped to this type. `@nvcct/db-entities`'s `otps` table is
 * shared across REGISTER/FORGOT/TWO_FACTOR flows (indexed on `{ userId, type }`),
 * so omitting `type` here would let a registration OTP collide with — or be
 * clobbered by — another flow's code for the same user.
 */
const OTP_TYPE = 'REGISTER';

/** A stored OTP, mapped to the domain (no Postgres details leak upward). */
export interface OtpRecord {
  id: string;
  codeHash: string;
  attempts: number;
  createdAt: Date;
}

export interface IOtpRepository {
  /** The single unexpired OTP for a user, or `null`. */
  findActiveForUser(userId: string): Promise<OtpRecord | null>;
  /** Replace any existing OTP for the user with a fresh one (single active OTP). */
  replaceForUser(userId: string, codeHash: string, expiresAt: Date): Promise<void>;
  /** Record a wrong-code attempt and return the new attempt count. */
  recordFailedAttempt(otpId: string): Promise<number>;
  /** Remove every OTP for a user (on success or lockout). */
  deleteForUser(userId: string): Promise<void>;
}

/**
 * Stores account-verification OTPs by SHA-256 hash. At most one OTP is active per
 * user (per `OTP_TYPE`) at a time; expired ones are also swept by the `pg_cron`
 * job defined in `@nvcct/db-entities`'s migrations.
 */
export class OtpRepository implements IOtpRepository {
  async findActiveForUser(userId: string): Promise<OtpRecord | null> {
    const [row] = await db
      .select()
      .from(otpsTable)
      .where(
        and(
          eq(otpsTable.userId, userId),
          eq(otpsTable.type, OTP_TYPE),
          gt(otpsTable.expiresAt, new Date())
        )
      )
      .limit(1);
    return row
      ? { id: row.id, codeHash: row.codeHash, attempts: row.attempts, createdAt: row.createdAt }
      : null;
  }

  async replaceForUser(userId: string, codeHash: string, expiresAt: Date): Promise<void> {
    await db
      .delete(otpsTable)
      .where(and(eq(otpsTable.userId, userId), eq(otpsTable.type, OTP_TYPE)));
    await db.insert(otpsTable).values({ userId, type: OTP_TYPE, codeHash, expiresAt });
  }

  async recordFailedAttempt(otpId: string): Promise<number> {
    const [row] = await db
      .update(otpsTable)
      .set({ attempts: sql`${otpsTable.attempts} + 1` })
      .where(eq(otpsTable.id, otpId))
      .returning({ attempts: otpsTable.attempts });
    return row ? row.attempts : 0;
  }

  async deleteForUser(userId: string): Promise<void> {
    await db
      .delete(otpsTable)
      .where(and(eq(otpsTable.userId, userId), eq(otpsTable.type, OTP_TYPE)));
  }
}
