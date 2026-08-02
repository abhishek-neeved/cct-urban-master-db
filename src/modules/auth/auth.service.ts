import { env, isProduction } from '@config/env';
import { LOGIN_MAX_ATTEMPTS, OTP_MAX_ATTEMPTS } from '@config/constants';
import type { UserRole } from './auth.model';
import { User } from './user.types';
import { IUserRepository } from './user.repository';
import { IRefreshTokenRepository } from './refresh-token.repository';
import { IOtpRepository, OtpType } from './otp.repository';
import { ILoginAttemptRepository } from './login-attempt.repository';
import { IEmailService } from '@shared/services/email.service';
import { comparePassword, getDummyPasswordHash, hashPassword } from '@utils/password.util';
import {
  generateNumericOtp,
  generateOpaqueToken,
  hashToken,
  signAccessToken,
} from '@utils/token.util';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '@utils/errors';
import { logger } from '@utils/logger';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: User;
  tokens: AuthTokens;
}

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  /** The signup account-type choice — "provide a service" vs. "book a service". */
  role: Exclude<UserRole, 'admin'>;
}

export interface RegisterResult {
  user: User;
  /** Raw OTP, returned only in non-production so the flow can be tested locally. */
  devOtp?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SECOND_MS = 1000;

/**
 * Standard JWT auth flow: register/login issue a short-lived access token plus
 * a rotating opaque refresh token; password reset uses a single-use hashed
 * token delivered by email. Business logic only — no HTTP, no mongoose.
 */
export class AuthService {
  constructor(
    private readonly users: IUserRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly otps: IOtpRepository,
    private readonly loginAttempts: ILoginAttemptRepository,
    private readonly email: IEmailService
  ) {}

  /**
   * Creates the account but does not log the caller in — no tokens are issued
   * here. The account starts unverified (`isVerified: false`); a verification
   * OTP is emailed, and the caller must verify (and then log in) separately.
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('A user with this email already exists');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await this.users.create({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      password: passwordHash,
      role: input.role,
    });
    const rawOtp = await this.issueOtp(user.id, 'REGISTER');
    await this.email.sendOtpEmail(user.email, rawOtp);
    logger.info('User registered', { userId: user.id, role: user.role });
    return { user, devOtp: isProduction ? undefined : rawOtp };
  }

  /**
   * Verify an account with the emailed OTP. Every failure resolves to the same
   * generic error so the endpoint reveals nothing about which accounts exist or
   * are already verified. A wrong code counts against the attempt cap; once the
   * cap is hit the OTP is discarded and the user must request a new one.
   */
  async verifyOtp(email: string, code: string): Promise<void> {
    const invalid = new BadRequestError('Invalid or expired verification code');

    const user = await this.users.findByEmail(email);
    if (!user || user.isVerified) {
      throw invalid;
    }
    const otp = await this.otps.findActiveForUser(user.id, 'REGISTER');
    if (!otp) {
      throw invalid;
    }
    if (otp.codeHash !== hashToken(code)) {
      const attempts = await this.otps.recordFailedAttempt(otp.id);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        // Too many wrong guesses — burn the code so it can't be brute-forced.
        await this.otps.deleteForUser(user.id, 'REGISTER');
      }
      throw invalid;
    }
    await this.users.markVerified(user.id);
    await this.otps.deleteForUser(user.id, 'REGISTER');
    logger.info('Account verified', { userId: user.id });
  }

  /**
   * Re-issue a verification OTP. Always resolves the same way whether or not the
   * account exists / is already verified (no enumeration). A resend within the
   * cooldown window is a silent no-op. Returns the raw OTP only in non-production.
   */
  async resendOtp(email: string): Promise<string | undefined> {
    const user = await this.users.findByEmail(email);
    if (!user || user.isVerified) {
      return undefined;
    }
    const active = await this.otps.findActiveForUser(user.id, 'REGISTER');
    if (active) {
      const ageMs = Date.now() - active.createdAt.getTime();
      if (ageMs < env.OTP_RESEND_COOLDOWN_SECONDS * SECOND_MS) {
        // Still within the cooldown — do nothing, but reveal nothing either.
        return undefined;
      }
    }
    const rawOtp = await this.issueOtp(user.id, 'REGISTER');
    await this.email.sendOtpEmail(user.email, rawOtp);
    logger.info('Verification OTP resent', { userId: user.id });
    return isProduction ? undefined : rawOtp;
  }

  /** Returns the profile of an authenticated user (token already verified). */
  async getProfile(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      // Token is valid but the account no longer exists.
      throw new UnauthorizedError('User no longer exists');
    }
    return user;
  }

  /**
   * Login lockout is tracked per **email** (`this.loginAttempts`), not per
   * user id, and is written to identically whether or not that email belongs
   * to a real account. If only real accounts accumulated failed attempts —
   * e.g. a counter living on the user document — an attacker could tell a
   * registered email apart from a made-up one just by noticing that repeated
   * wrong guesses against it eventually behave differently (extra writes,
   * then a lock) while a made-up email never would. Keeping the two lookups
   * (`loginAttempts`, `users`) and the dummy-hash compare fully symmetric
   * between the "account exists" and "account doesn't exist" branches is what
   * closes both that message/status leak and the underlying timing one.
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const invalidCredentials = new UnauthorizedError('Invalid email or password');
    const email = input.email.toLowerCase();

    const attemptState = await this.loginAttempts.find(email);
    const isLocked = Boolean(attemptState?.lockedUntil && attemptState.lockedUntil > new Date());

    const record = await this.users.findByEmailWithPassword(email);

    // Always run the bcrypt compare — against the real hash if the account
    // exists, a dummy one otherwise — so a missing account, a wrong password,
    // and a locked account all cost the same time (no timing enumeration).
    const passwordMatches = record
      ? await comparePassword(input.password, record.password)
      : await comparePassword(input.password, await getDummyPasswordHash()).then(() => false);

    if (isLocked) {
      // Same generic error as a wrong password: disclosing "this account is
      // locked" would itself be an enumeration signal, so the lock — and the
      // fact that it only applies to real accounts — is never revealed.
      throw invalidCredentials;
    }

    if (!record || !passwordMatches) {
      const attempts = await this.loginAttempts.recordFailedAttempt(email);
      if (attempts >= LOGIN_MAX_ATTEMPTS) {
        await this.loginAttempts.lock(
          email,
          new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * MINUTE_MS)
        );
        logger.warn('Login temporarily locked after repeated failed attempts', { email });
      }
      throw invalidCredentials;
    }

    // Credentials are correct but the account is unverified — the password check
    // ran first so this can't be used to probe which emails are registered.
    if (!record.isVerified) {
      throw new ForbiddenError('Please verify your email before logging in');
    }

    await this.loginAttempts.reset(email);
    const { password, ...user } = record;
    const tokens = await this.issueTokens(user.id);
    return { user, tokens };
  }

  /**
   * Rotation with reuse detection: the presented token is atomically swapped
   * for a new one in the same family (single-use — a concurrent request with
   * the same token loses the race). If the presented token had *already* been
   * rotated out before, that's only possible if it leaked (e.g. was stolen and
   * used by an attacker) — the repository treats that as a compromise signal
   * and revokes every token in the family, so this rejects with the same
   * generic 401 and the caller must log in again from scratch.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const invalid = new UnauthorizedError('Invalid or expired refresh token');
    const newRefreshToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);

    const result = await this.refreshTokens.rotate(
      hashToken(refreshToken),
      hashToken(newRefreshToken),
      expiresAt
    );

    if (result.status === 'reused') {
      logger.warn('Refresh token reuse detected — all sessions revoked', {
        userId: result.userId,
      });
      throw invalid;
    }
    if (result.status === 'invalid') {
      throw invalid;
    }

    const accessToken = signAccessToken(result.userId);
    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens.deleteByHash(hashToken(refreshToken));
  }

  /**
   * Always resolves the same way whether or not the email exists (no account
   * enumeration). Returns the raw OTP only in non-production, as a
   * convenience for local testing.
   */
  async forgotPassword(email: string): Promise<string | undefined> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return undefined;
    }
    const rawOtp = await this.issueOtp(user.id, 'RESET');
    await this.email.sendOtpEmail(user.email, rawOtp);
    logger.info('Password-reset OTP sent', { userId: user.id });
    return isProduction ? undefined : rawOtp;
  }

  /**
   * One-shot: the OTP is both the proof of mailbox ownership and the
   * authorization to set the new password — no separate reset-session token.
   * Every failure resolves to the same generic error (no account/OTP-state
   * enumeration), mirroring `verifyOtp`'s attempt-cap behavior.
   */
  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const invalid = new BadRequestError('Invalid or expired verification code');

    const user = await this.users.findByEmail(email);
    if (!user) {
      throw invalid;
    }
    const otp = await this.otps.findActiveForUser(user.id, 'RESET');
    if (!otp) {
      throw invalid;
    }
    if (otp.codeHash !== hashToken(code)) {
      const attempts = await this.otps.recordFailedAttempt(otp.id);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.otps.deleteForUser(user.id, 'RESET');
      }
      throw invalid;
    }
    await this.otps.deleteForUser(user.id, 'RESET');

    const passwordHash = await hashPassword(newPassword);
    await this.users.updatePassword(user.id, passwordHash);
    // Clear any login lockout — proving control of the mailbox via the OTP is
    // a stronger proof of ownership than the password ever was.
    await this.loginAttempts.reset(user.email);
    // Force re-login everywhere after a password change.
    await this.refreshTokens.deleteAllForUser(user.id);
    logger.info('Password reset', { userId: user.id });
  }

  /**
   * Authenticated change-password — verifies the caller's current password
   * server-side before setting the new one, unlike `resetPassword` (which
   * trusts a mailed OTP instead, for a caller who can't log in at all).
   * Forces re-login everywhere afterwards, same as a reset.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const record = await this.users.findByIdWithPassword(userId);
    if (!record) {
      throw new UnauthorizedError('User no longer exists');
    }
    const matches = await comparePassword(currentPassword, record.password);
    if (!matches) {
      throw new BadRequestError('Current password is incorrect');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.users.updatePassword(userId, passwordHash);
    await this.refreshTokens.deleteAllForUser(userId);
    logger.info('Password changed', { userId });
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const accessToken = signAccessToken(userId);
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
    await this.refreshTokens.create(userId, hashToken(refreshToken), expiresAt);
    return { accessToken, refreshToken };
  }

  /** Generate a fresh OTP for the given flow, replacing any existing one, and return the raw code. */
  private async issueOtp(userId: string, type: OtpType): Promise<string> {
    const rawOtp = generateNumericOtp();
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * MINUTE_MS);
    await this.otps.replaceForUser(userId, type, hashToken(rawOtp), expiresAt);
    return rawOtp;
  }
}
