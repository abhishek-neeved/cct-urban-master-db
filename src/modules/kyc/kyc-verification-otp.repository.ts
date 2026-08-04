import { isValidObjectId } from 'mongoose';
import { KycVerificationOtpModel, type VerificationDocType } from './kyc.model';

/** A stored verification OTP, mapped to the domain (no MongoDB details leak upward). */
export interface KycVerificationOtpRecord {
  id: string;
  docValue: string;
  codeHash: string;
  attempts: number;
  createdAt: Date;
}

export interface IKycVerificationOtpRepository {
  /** The single unexpired OTP for a user and doc type, or `null`. */
  findActiveForUser(
    userId: string,
    docType: VerificationDocType
  ): Promise<KycVerificationOtpRecord | null>;
  /** Replace any existing OTP for the user and doc type with a fresh one (single active OTP per doc type). */
  replaceForUser(
    userId: string,
    docType: VerificationDocType,
    docValue: string,
    codeHash: string,
    expiresAt: Date
  ): Promise<void>;
  /** Record a wrong-code attempt and return the new attempt count. */
  recordFailedAttempt(otpId: string): Promise<number>;
  /** Remove every OTP for a user and doc type (on success or lockout). */
  deleteForUser(userId: string, docType: VerificationDocType): Promise<void>;
}

/**
 * Stores Aadhaar/PAN verification OTPs by SHA-256 hash, scoped by
 * `{ userId, docType }` so the two checks never cross-consume each other's
 * code — mirrors `@modules/auth/otp.repository`'s pattern exactly.
 */
export class KycVerificationOtpRepository implements IKycVerificationOtpRepository {
  async findActiveForUser(
    userId: string,
    docType: VerificationDocType
  ): Promise<KycVerificationOtpRecord | null> {
    const doc = await KycVerificationOtpModel.findOne({
      userId,
      docType,
      expiresAt: { $gt: new Date() },
    }).lean();
    return doc
      ? {
          id: String(doc._id),
          docValue: doc.docValue,
          codeHash: doc.codeHash,
          attempts: doc.attempts,
          createdAt: doc.createdAt,
        }
      : null;
  }

  async replaceForUser(
    userId: string,
    docType: VerificationDocType,
    docValue: string,
    codeHash: string,
    expiresAt: Date
  ): Promise<void> {
    await KycVerificationOtpModel.deleteMany({ userId, docType });
    await KycVerificationOtpModel.create({ userId, docType, docValue, codeHash, expiresAt });
  }

  async recordFailedAttempt(otpId: string): Promise<number> {
    if (!isValidObjectId(otpId)) return 0;
    const doc = await KycVerificationOtpModel.findByIdAndUpdate(
      otpId,
      { $inc: { attempts: 1 } },
      { new: true }
    ).lean();
    return doc ? doc.attempts : 0;
  }

  async deleteForUser(userId: string, docType: VerificationDocType): Promise<void> {
    await KycVerificationOtpModel.deleteMany({ userId, docType });
  }
}
