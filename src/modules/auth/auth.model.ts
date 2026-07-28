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
 * Login-attempt throttling, keyed by **email** rather than user id — and
 * written to identically whether or not that email belongs to a real
 * account. If only real accounts accumulated attempts/lockouts, an attacker
 * could tell a registered email apart from a made-up one just by noticing
 * that repeated wrong guesses against it eventually start behaving
 * differently (extra writes, then a lock) while a made-up email never does.
 * Keeping this in its own email-keyed collection — instead of on `UserModel`
 * — is what makes that parity possible even when no user document exists.
 */
export interface LoginAttemptRow {
  _id: Types.ObjectId;
  email: string;
  attempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const loginAttemptSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    attempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

export const LoginAttemptModel = model<LoginAttemptRow>('LoginAttempt', loginAttemptSchema);

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

/**
 * Refresh tokens are stored by SHA-256 hash so a stolen DB never yields usable
 * tokens. Rotation keeps every token issued from the same login in one
 * `familyId` and marks a token `usedAt` instead of deleting it immediately —
 * that's what lets `rotate()` (see `refresh-token.repository`) tell a replayed
 * (already-used) token apart from one that's merely unknown, and revoke the
 * whole family when a replay signals the token may have been stolen.
 */
export interface RefreshTokenRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  usedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
refreshTokenSchema.index({ familyId: 1 });

export const RefreshTokenModel = model<RefreshTokenRow>('RefreshToken', refreshTokenSchema);
