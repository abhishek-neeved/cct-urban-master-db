import { Schema, model, Types } from 'mongoose';

export interface RefreshTokenAttrs {
  user: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenAttrs>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Only the SHA-256 hash of the refresh token is stored, never the raw value.
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL index: MongoDB removes each document once `expiresAt` passes.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model<RefreshTokenAttrs>('RefreshToken', refreshTokenSchema);
