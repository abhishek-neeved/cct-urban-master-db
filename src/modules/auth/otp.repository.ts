import { Otp as OtpModel } from '@nvcct/db-entities';

/**
 * This repository only ever issues/consumes the account-verification flow, so
 * every query is scoped to this type. `@nvcct/db-entities`'s `Otp` collection
 * is shared across REGISTER/FORGOT/TWO_FACTOR flows (indexed on `{ user, type }`),
 * so omitting `type` here would let a registration OTP collide with — or be
 * clobbered by — another flow's code for the same user.
 */
const OTP_TYPE = 'REGISTER';

/** A stored OTP, mapped to the domain (no Mongo details leak upward). */
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
 * user (per `OTP_TYPE`) at a time; expired ones are also swept by the TTL index
 * on the model.
 */
export class OtpRepository implements IOtpRepository {
  async findActiveForUser(userId: string): Promise<OtpRecord | null> {
    const doc = await OtpModel.findOne({
      user: userId,
      type: OTP_TYPE,
      expiresAt: { $gt: new Date() },
    }).exec();
    return doc
      ? {
          id: doc._id.toString(),
          codeHash: doc.codeHash,
          attempts: doc.attempts,
          createdAt: doc.createdAt,
        }
      : null;
  }

  async replaceForUser(userId: string, codeHash: string, expiresAt: Date): Promise<void> {
    await OtpModel.deleteMany({ user: userId, type: OTP_TYPE }).exec();
    await OtpModel.create({ user: userId, type: OTP_TYPE, codeHash, expiresAt });
  }

  async recordFailedAttempt(otpId: string): Promise<number> {
    const doc = await OtpModel.findByIdAndUpdate(
      otpId,
      { $inc: { attempts: 1 } },
      { returnDocument: 'after' }
    ).exec();
    return doc ? doc.attempts : 0;
  }

  async deleteForUser(userId: string): Promise<void> {
    await OtpModel.deleteMany({ user: userId, type: OTP_TYPE }).exec();
  }
}
