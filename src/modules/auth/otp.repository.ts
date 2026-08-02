import { isValidObjectId } from 'mongoose';
import { OtpModel } from './auth.model';

/**
 * The `otps` collection is shared across flows (indexed on `{ userId, type }`)
 * so a registration OTP can't collide with — or be clobbered by — a
 * password-reset code for the same user. Every query is explicitly scoped by
 * `type` for that reason.
 */
export type OtpType = 'REGISTER' | 'RESET';

/** A stored OTP, mapped to the domain (no MongoDB details leak upward). */
export interface OtpRecord {
  id: string;
  codeHash: string;
  attempts: number;
  createdAt: Date;
}

export interface IOtpRepository {
  /** The single unexpired OTP for a user and flow, or `null`. */
  findActiveForUser(userId: string, type: OtpType): Promise<OtpRecord | null>;
  /** Replace any existing OTP for the user and flow with a fresh one (single active OTP per type). */
  replaceForUser(userId: string, type: OtpType, codeHash: string, expiresAt: Date): Promise<void>;
  /** Record a wrong-code attempt and return the new attempt count. */
  recordFailedAttempt(otpId: string): Promise<number>;
  /** Remove every OTP for a user and flow (on success or lockout). */
  deleteForUser(userId: string, type: OtpType): Promise<void>;
}

/** Stores OTPs by SHA-256 hash. At most one OTP is active per user per `type` at a time. */
export class OtpRepository implements IOtpRepository {
  async findActiveForUser(userId: string, type: OtpType): Promise<OtpRecord | null> {
    const doc = await OtpModel.findOne({
      userId,
      type,
      expiresAt: { $gt: new Date() },
    }).lean();
    return doc
      ? {
          id: String(doc._id),
          codeHash: doc.codeHash,
          attempts: doc.attempts,
          createdAt: doc.createdAt,
        }
      : null;
  }

  async replaceForUser(userId: string, type: OtpType, codeHash: string, expiresAt: Date): Promise<void> {
    await OtpModel.deleteMany({ userId, type });
    await OtpModel.create({ userId, type, codeHash, expiresAt });
  }

  async recordFailedAttempt(otpId: string): Promise<number> {
    if (!isValidObjectId(otpId)) return 0;
    const doc = await OtpModel.findByIdAndUpdate(
      otpId,
      { $inc: { attempts: 1 } },
      { new: true }
    ).lean();
    return doc ? doc.attempts : 0;
  }

  async deleteForUser(userId: string, type: OtpType): Promise<void> {
    await OtpModel.deleteMany({ userId, type });
  }
}
