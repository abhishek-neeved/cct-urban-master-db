import { isValidObjectId } from 'mongoose';
import { KycOtpModel } from './kyc.model';

/** A stored mobile-verification OTP, mapped to the domain (no MongoDB details leak upward). */
export interface KycOtpRecord {
  id: string;
  mobileNumber: string;
  codeHash: string;
  attempts: number;
  createdAt: Date;
}

export interface IKycOtpRepository {
  /** The single unexpired OTP for a user, or `null`. */
  findActiveForUser(userId: string): Promise<KycOtpRecord | null>;
  /** Replace any existing OTP for the user with a fresh one (single active OTP per user). */
  replaceForUser(
    userId: string,
    mobileNumber: string,
    codeHash: string,
    expiresAt: Date
  ): Promise<void>;
  /** Record a wrong-code attempt and return the new attempt count. */
  recordFailedAttempt(otpId: string): Promise<number>;
  /** Remove every OTP for a user (on success or lockout). */
  deleteForUser(userId: string): Promise<void>;
}

/** Stores mobile-verification OTPs by SHA-256 hash — mirrors `@modules/auth/otp.repository`'s pattern exactly. */
export class KycOtpRepository implements IKycOtpRepository {
  async findActiveForUser(userId: string): Promise<KycOtpRecord | null> {
    const doc = await KycOtpModel.findOne({ userId, expiresAt: { $gt: new Date() } }).lean();
    return doc
      ? {
          id: String(doc._id),
          mobileNumber: doc.mobileNumber,
          codeHash: doc.codeHash,
          attempts: doc.attempts,
          createdAt: doc.createdAt,
        }
      : null;
  }

  async replaceForUser(
    userId: string,
    mobileNumber: string,
    codeHash: string,
    expiresAt: Date
  ): Promise<void> {
    await KycOtpModel.deleteMany({ userId });
    await KycOtpModel.create({ userId, mobileNumber, codeHash, expiresAt });
  }

  async recordFailedAttempt(otpId: string): Promise<number> {
    if (!isValidObjectId(otpId)) return 0;
    const doc = await KycOtpModel.findByIdAndUpdate(
      otpId,
      { $inc: { attempts: 1 } },
      { new: true }
    ).lean();
    return doc ? doc.attempts : 0;
  }

  async deleteForUser(userId: string): Promise<void> {
    await KycOtpModel.deleteMany({ userId });
  }
}
