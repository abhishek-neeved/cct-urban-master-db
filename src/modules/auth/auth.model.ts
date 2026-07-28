import { Schema, model, type Types } from 'mongoose';

/**
 * Mongoose schemas/models for the auth module, owned by this module (not a
 * shared schema package) — `firstName`/`lastName`/`email`/`password` etc. are
 * only ever read through this module's repositories.
 */

export interface UserRow {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  isVerified: boolean;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 120 },
    lastName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, required: true, default: false },
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

export const UserModel = model<UserRow>('User', userSchema);

/**
 * This model only ever stores/consumes the account-verification flow's OTPs,
 * scoped by `type` (indexed on `{ userId, type }`) so a registration OTP
 * can't collide with — or be clobbered by — another flow's code for the same
 * user (e.g. a future FORGOT/TWO_FACTOR flow sharing this collection).
 */
export interface OtpRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

const otpSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    type: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
otpSchema.index({ userId: 1, type: 1 });

export const OtpModel = model<OtpRow>('Otp', otpSchema);

/** Refresh tokens are stored by SHA-256 hash so a stolen DB never yields usable tokens. */
export interface RefreshTokenRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const RefreshTokenModel = model<RefreshTokenRow>('RefreshToken', refreshTokenSchema);
