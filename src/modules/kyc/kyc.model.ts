import { Schema, model, type Types } from 'mongoose';

export type KycStatus = 'not_started' | 'pending' | 'verified' | 'rejected';

/**
 * Which government-id check a verification OTP belongs to. Aadhaar and PAN
 * are verified independently — each has its own OTP round-trip — so a
 * pending Aadhaar OTP can never be consumed by a PAN verify call, or vice
 * versa.
 */
export type VerificationDocType = 'aadhar' | 'pan';

/**
 * Mongoose schema for the kyc module, owned by this module (not a shared
 * schema package) — mirrors auth's `auth.model.ts` convention. One document
 * per user (`userId` is unique); "not_started" is never persisted — it is the
 * domain default returned when no document exists yet (see `kyc.types.ts`'s
 * `toKycRecord`).
 *
 * No document uploads today (aadharImageKey/panImageKey/photographKey/uan
 * were removed) — identity is instead proven by verifying Aadhaar/PAN via a
 * mocked OTP round-trip (see `KycVerifiedDocumentModel` below); `submit()`
 * only accepts a submission once both are verified for the exact numbers
 * being submitted.
 */
export interface KycRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: Exclude<KycStatus, 'not_started'>;
  aadharNumber: string;
  panNumber: string;
  address: string;
  submittedAt: Date;
  rejectionReason: string | null;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const kycSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', unique: true },
    status: { type: String, enum: ['pending', 'verified', 'rejected'], required: true },
    aadharNumber: { type: String, required: true },
    panNumber: { type: String, required: true },
    address: { type: String, required: true },
    submittedAt: { type: Date, required: true },
    rejectionReason: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const KycModel = model<KycRow>('Kyc', kycSchema);

/**
 * A pending Aadhaar/PAN verification OTP for a user, scoped by `docType` so
 * the two checks can never cross-consume each other's code. Deleted once
 * consumed (mirrors `OtpModel` in `auth.model.ts`, but kept in its own
 * collection since it's a KYC concern, not an account-credential one).
 */
export interface KycVerificationOtpRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  docType: VerificationDocType;
  /** The Aadhaar/PAN number this OTP was issued for — re-verifying a changed number requires a fresh OTP. */
  docValue: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

const kycVerificationOtpSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    docType: { type: String, enum: ['aadhar', 'pan'], required: true },
    docValue: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
kycVerificationOtpSchema.index({ userId: 1, docType: 1 });

export const KycVerificationOtpModel = model<KycVerificationOtpRow>(
  'KycVerificationOtp',
  kycVerificationOtpSchema
);

/**
 * Persisted proof that a user successfully verified a specific Aadhaar/PAN
 * number via OTP — written once the OTP check in `KycVerificationOtpModel`
 * succeeds, and never deleted (unlike the OTP itself). `submit()` checks
 * this collection for a record matching the *exact* number being submitted,
 * so verifying "1234" and then submitting a changed "5678" is correctly
 * treated as unverified — a changed number always needs a fresh OTP.
 */
export interface KycVerifiedDocumentRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  docType: VerificationDocType;
  docValue: string;
  verifiedAt: Date;
}

const kycVerifiedDocumentSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  docType: { type: String, enum: ['aadhar', 'pan'], required: true },
  docValue: { type: String, required: true },
  verifiedAt: { type: Date, required: true },
});
kycVerifiedDocumentSchema.index({ userId: 1, docType: 1 }, { unique: true });

export const KycVerifiedDocumentModel = model<KycVerifiedDocumentRow>(
  'KycVerifiedDocument',
  kycVerifiedDocumentSchema
);
