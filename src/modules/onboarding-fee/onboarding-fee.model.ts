import { Schema, model, type Types } from 'mongoose';
import type { RazorpayPaymentLinkStatus } from '@shared/services/payment-gateway.service';

export type { RazorpayPaymentLinkStatus };

/**
 * Mongoose schema for the onboarding-fee module, owned by this module (not a
 * shared schema package) — mirrors auth's `auth.model.ts` convention. One
 * document per user (`userId` is unique) — a one-time payment, paid at most
 * once per account, ever (see `onboarding-fee.service.ts`).
 */
export interface OnboardingFeeRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  razorpayPaymentLinkId: string;
  status: RazorpayPaymentLinkStatus;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const onboardingFeeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', unique: true },
    razorpayPaymentLinkId: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['created', 'partially_paid', 'paid', 'cancelled', 'expired'],
      required: true,
    },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const OnboardingFeeModel = model<OnboardingFeeRow>('OnboardingFee', onboardingFeeSchema);
