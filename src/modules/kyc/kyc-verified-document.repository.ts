import { KycVerifiedDocumentModel, type VerificationDocType } from './kyc.model';

export interface IKycVerifiedDocumentRepository {
  /** Whether this exact docType+docValue was verified for this user. */
  isVerified(userId: string, docType: VerificationDocType, docValue: string): Promise<boolean>;
  /** Record a successful verification, replacing any prior one for the same docType. */
  markVerified(userId: string, docType: VerificationDocType, docValue: string): Promise<void>;
}

/** Persisted Aadhaar/PAN verification proof — see `KycVerifiedDocumentModel`. */
export class KycVerifiedDocumentRepository implements IKycVerifiedDocumentRepository {
  async isVerified(
    userId: string,
    docType: VerificationDocType,
    docValue: string
  ): Promise<boolean> {
    const exists = await KycVerifiedDocumentModel.exists({ userId, docType, docValue });
    return exists !== null;
  }

  async markVerified(
    userId: string,
    docType: VerificationDocType,
    docValue: string
  ): Promise<void> {
    await KycVerifiedDocumentModel.findOneAndUpdate(
      { userId, docType },
      { docValue, verifiedAt: new Date() },
      { upsert: true }
    );
  }
}
