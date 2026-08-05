import { Schema, model, type Types } from 'mongoose';
import type { ServiceCategory } from '@modules/auth/auth.model';

/**
 * Service-specific details for a `service_provider`, kept in its own
 * collection rather than on `User` — this is business-profile data (what a
 * provider offers, and for how long), not an account/credential field, and
 * it's the natural place to grow (pricing, service area, portfolio) without
 * crowding the auth module's user document. One document per user (`userId`
 * is unique).
 */
export interface ServiceProfileRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  category: ServiceCategory;
  description: string | null;
  yearsOfExperience: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const serviceProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', unique: true },
    category: {
      type: String,
      enum: ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'other'],
      required: true,
    },
    description: { type: String, default: null, trim: true, maxlength: 1000 },
    yearsOfExperience: { type: Number, default: null, min: 0, max: 80 },
  },
  { timestamps: true }
);

export const ServiceProfileModel = model<ServiceProfileRow>('ServiceProfile', serviceProfileSchema);
