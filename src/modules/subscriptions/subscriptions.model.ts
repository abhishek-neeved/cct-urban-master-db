import { Schema, model, type Types } from 'mongoose';
import type { RazorpaySubscriptionStatus } from '@shared/services/payment-gateway.service';

export type { RazorpaySubscriptionStatus };

/**
 * Mongoose schema for the subscriptions module, owned by this module (not a
 * shared schema package) — mirrors auth's `auth.model.ts` convention. One
 * document per user (`userId` is unique).
 */
export interface SubscriptionRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  razorpaySubscriptionId: string;
  razorpayStatus: RazorpaySubscriptionStatus;
  startedAt: Date | null;
  renewsAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', unique: true },
    razorpaySubscriptionId: { type: String, required: true, unique: true },
    razorpayStatus: {
      type: String,
      enum: ['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired'],
      required: true,
    },
    startedAt: { type: Date, default: null },
    renewsAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const SubscriptionModel = model<SubscriptionRow>('Subscription', subscriptionSchema);
