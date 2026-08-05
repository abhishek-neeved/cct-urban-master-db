import { Schema, model, type Types } from 'mongoose';

export type KycStatus = 'not_started' | 'pending' | 'verified' | 'rejected';

/**
 * Mongoose schema for the kyc module, owned by this module (not a shared
 * schema package) — mirrors auth's `auth.model.ts` convention. One document
 * per user (`userId` is unique), created incrementally: mobile number
 * verification (OTP) comes first and gates Aadhaar/PAN verification;
 * Aadhaar/PAN are each verified by comparing the user-entered number against
 * `mobileLookup` — CoinCircleTrust's mobile-to-pan response for the
 * verified mobile number, fetched and cached exactly once when the mobile
 * OTP confirms (see `KycService.confirmMobileOtp`), not re-fetched by each
 * of Aadhaar/PAN's own verify calls. That's a real, billed API call, so
 * caching it here is a direct cost optimization, not just a performance one.
 * Re-verifying a different mobile number replaces `mobileLookup` and resets
 * `aadhaarVerified`/`panVerified` to `false` — they were checked against
 * the old number's identity and no longer apply. `status` stays
 * `not_started` (the row already exists, but nothing has been submitted for
 * review yet) until `submit()` requires all three `*Verified` flags true.
 */
export interface KycRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: KycStatus;
  mobileNumber: string | null;
  mobileVerified: boolean;
  /** CoinCircleTrust's mobile-to-pan response for `mobileNumber`, cached verbatim (snake_case, as received) — see `MobileToPanResult`. */
  mobileLookup: Record<string, unknown> | null;
  aadharNumber: string | null;
  aadhaarVerified: boolean;
  panNumber: string | null;
  panVerified: boolean;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  submittedAt: Date | null;
  rejectionReason: string | null;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const kycSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', unique: true },
    status: {
      type: String,
      enum: ['not_started', 'pending', 'verified', 'rejected'],
      required: true,
    },
    mobileNumber: { type: String, default: null },
    mobileVerified: { type: Boolean, required: true, default: false },
    mobileLookup: { type: Schema.Types.Mixed, default: null },
    aadharNumber: { type: String, default: null },
    aadhaarVerified: { type: Boolean, required: true, default: false },
    panNumber: { type: String, default: null },
    panVerified: { type: Boolean, required: true, default: false },
    addressLine: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    pincode: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const KycModel = model<KycRow>('Kyc', kycSchema);

/**
 * A pending mobile-number verification OTP for a user. Deleted once
 * consumed (mirrors `OtpModel` in `auth.model.ts`, but kept in its own
 * collection since it's a KYC concern, not an account-credential one) —
 * this is the only OTP in the KYC flow now; Aadhaar/PAN are verified by
 * comparison against the mobile-to-pan lookup, not their own OTP.
 */
export interface KycOtpRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  mobileNumber: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

const kycOtpSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    mobileNumber: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
kycOtpSchema.index({ userId: 1 });

export const KycOtpModel = model<KycOtpRow>('KycOtp', kycOtpSchema);
