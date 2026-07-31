import { Schema, model, type Types } from 'mongoose';

export type KycStatus = 'not_started' | 'pending' | 'verified' | 'rejected';

/**
 * Mongoose schema for the kyc module, owned by this module (not a shared
 * schema package) — mirrors auth's `auth.model.ts` convention. One document
 * per user (`userId` is unique); "not_started" is never persisted — it is the
 * domain default returned when no document exists yet (see `kyc.types.ts`'s
 * `toKycRecord`).
 */
export interface KycRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: Exclude<KycStatus, 'not_started'>;
  aadharNumber: string;
  aadharImageKey: string;
  panNumber: string;
  panImageKey: string;
  dateOfBirth: Date | null;
  address: string;
  photographKey: string;
  uan: string | null;
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
    aadharImageKey: { type: String, required: true },
    panNumber: { type: String, required: true },
    panImageKey: { type: String, required: true },
    dateOfBirth: { type: Date, default: null },
    address: { type: String, required: true },
    photographKey: { type: String, required: true },
    uan: { type: String, default: null },
    submittedAt: { type: Date, required: true },
    rejectionReason: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const KycModel = model<KycRow>('Kyc', kycSchema);
