import { env, isProduction } from '@config/env';
import { OTP_MAX_ATTEMPTS } from '@config/constants';
import { User } from './user.types';
import { IUserRepository } from './user.repository';
import { IRefreshTokenRepository } from './refresh-token.repository';
import { IOtpRepository } from './otp.repository';
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
    });
    const rawOtp = await this.issueOtp(user.id);
    await this.email.sendOtpEmail(user.email, rawOtp);
    logger.info('User registered', { userId: user.id });
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
    const otp = await this.otps.findActiveForUser(user.id);
    if (!otp) {
      throw invalid;
    }
    if (otp.codeHash !== hashToken(code)) {
      const attempts = await this.otps.recordFailedAttempt(otp.id);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        // Too many wrong guesses — burn the code so it can't be brute-forced.
        await this.otps.deleteForUser(user.id);
      }
      throw invalid;
    }
    await this.users.markVerified(user.id);
    await this.otps.deleteForUser(user.id);
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
    const active = await this.otps.findActiveForUser(user.id);
    if (active) {
      const ageMs = Date.now() - active.createdAt.getTime();
      if (ageMs < env.OTP_RESEND_COOLDOWN_SECONDS * SECOND_MS) {
        // Still within the cooldown — do nothing, but reveal nothing either.
        return undefined;
      }
    }
    const rawOtp = await this.issueOtp(user.id);
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

  async login(input: LoginInput): Promise<AuthResult> {
    const record = await this.users.findByEmailWithPassword(input.email);
    if (!record) {
      // Compare against a dummy hash so a missing account costs the same time as
      // a wrong password — otherwise the timing difference leaks which emails
      // are registered. Same error message either way (no enumeration).
      await comparePassword(input.password, await getDummyPasswordHash());
      throw new UnauthorizedError('Invalid email or password');
    }
    if (!(await comparePassword(input.password, record.password))) {
      throw new UnauthorizedError('Invalid email or password');
    }
    // Credentials are correct but the account is unverified — the password check
    // ran first so this can't be used to probe which emails are registered.
    if (!record.isVerified) {
      throw new ForbiddenError('Please verify your email before logging in');
    }
    const user: User = {
      id: record.id,
      firstName: record.firstName,
      lastName: record.lastName,
      email: record.email,
      isVerified: record.isVerified,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    const tokens = await this.issueTokens(user.id);
    return { user, tokens };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken);
    // Rotation: atomically consume the presented token so it's strictly
    // single-use. If two requests race with the same token, only the one that
    // wins the delete gets a userId back; the other is rejected.
    const userId = await this.refreshTokens.consumeByValidHash(tokenHash);
    if (!userId) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
    return this.issueTokens(userId);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens.deleteByHash(hashToken(refreshToken));
  }

  /**
   * Always resolves the same way whether or not the email exists (no account
   * enumeration). Returns the raw reset token only in non-production, as a
   * convenience for local testing.
   */
  async forgotPassword(email: string): Promise<string | undefined> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return undefined;
    }
    const rawToken = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * MINUTE_MS);
    await this.users.setPasswordResetToken(user.id, hashToken(rawToken), expiresAt);

    const resetUrl = `${env.APP_URL}/reset-password?token=${rawToken}`;
    await this.email.sendPasswordResetEmail(user.email, resetUrl);

    return isProduction ? undefined : rawToken;
  }

  async verifyResetToken(token: string): Promise<boolean> {
    const user = await this.users.findByValidResetToken(hashToken(token));
    return user !== null;
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.users.findByValidResetToken(hashToken(token));
    if (!user) {
      throw new BadRequestError('Invalid or expired password reset token');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.users.updatePassword(user.id, passwordHash);
    // Force re-login everywhere after a password change.
    await this.refreshTokens.deleteAllForUser(user.id);
    logger.info('Password reset', { userId: user.id });
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const accessToken = signAccessToken(userId);
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
    await this.refreshTokens.create(userId, hashToken(refreshToken), expiresAt);
    return { accessToken, refreshToken };
  }

  /** Generate a fresh OTP, replacing any existing one, and return the raw code. */
  private async issueOtp(userId: string): Promise<string> {
    const rawOtp = generateNumericOtp();
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * MINUTE_MS);
    await this.otps.replaceForUser(userId, hashToken(rawOtp), expiresAt);
    return rawOtp;
  }
}
