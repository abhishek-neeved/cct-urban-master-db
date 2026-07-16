import { vi, type Mocked } from 'vitest';
import { AuthService } from '@modules/auth/auth.service';
import { IUserRepository } from '@modules/auth/user.repository';
import { IRefreshTokenRepository } from '@modules/auth/refresh-token.repository';
import { IOtpRepository, OtpRecord } from '@modules/auth/otp.repository';
import { IEmailService } from '@shared/services/email.service';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '@utils/errors';
import { hashPassword } from '@utils/password.util';
import { hashToken } from '@utils/token.util';
import { OTP_MAX_ATTEMPTS } from '@config/constants';
import { User, UserWithPassword } from '@modules/auth/user.types';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: '00000000-0000-4000-8000-000000000000',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  isVerified: true,
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2020-01-01'),
  ...overrides,
});

const buildOtp = (code: string, overrides: Partial<OtpRecord> = {}): OtpRecord => ({
  id: '507f1f77bcf86cd799439099',
  codeHash: hashToken(code),
  attempts: 0,
  createdAt: new Date('2020-01-01'),
  ...overrides,
});

describe('AuthService', () => {
  let users: Mocked<IUserRepository>;
  let refreshTokens: Mocked<IRefreshTokenRepository>;
  let otps: Mocked<IOtpRepository>;
  let email: Mocked<IEmailService>;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      findByEmailWithPassword: vi.fn(),
      create: vi.fn(),
      setPasswordResetToken: vi.fn(),
      findByValidResetToken: vi.fn(),
      updatePassword: vi.fn(),
      markVerified: vi.fn(),
    };
    refreshTokens = {
      create: vi.fn(),
      findUserIdByValidHash: vi.fn(),
      consumeByValidHash: vi.fn(),
      deleteByHash: vi.fn(),
      deleteAllForUser: vi.fn(),
    };
    otps = {
      findActiveForUser: vi.fn(),
      replaceForUser: vi.fn(),
      recordFailedAttempt: vi.fn(),
      deleteForUser: vi.fn(),
    };
    email = { sendPasswordResetEmail: vi.fn(), sendOtpEmail: vi.fn() };
    service = new AuthService(users, refreshTokens, otps, email);
  });

  describe('register', () => {
    it('creates a user with a hashed password, issues an OTP, and does not issue tokens', async () => {
      const user = buildUser({ isVerified: false });
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(user);

      const result = await service.register({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        password: 'supersecret',
      });

      expect(result.user).toEqual(user);
      // Password passed to the repository must be hashed, not plaintext.
      const created = users.create.mock.calls[0][0];
      expect(created.password).not.toBe('supersecret');
      // An OTP is issued (hashed) and emailed, but the caller is not logged in.
      expect(otps.replaceForUser).toHaveBeenCalledTimes(1);
      expect(email.sendOtpEmail).toHaveBeenCalledTimes(1);
      expect(refreshTokens.create).not.toHaveBeenCalled();
      // Outside production the raw OTP is returned for local testing.
      expect(result.devOtp).toMatch(/^\d{6}$/);
      // The stored code is hashed, not the raw OTP that was emailed.
      const [, storedHash] = otps.replaceForUser.mock.calls[0];
      expect(storedHash).toBe(hashToken(result.devOtp as string));
      expect(storedHash).not.toBe(result.devOtp);
    });

    it('rejects a duplicate email with ConflictError', async () => {
      users.findByEmail.mockResolvedValue(buildUser());
      await expect(
        service.register({
          firstName: 'X',
          lastName: 'Y',
          email: 'ada@example.com',
          password: 'supersecret',
        })
      ).rejects.toBeInstanceOf(ConflictError);
      expect(users.create).not.toHaveBeenCalled();
      expect(otps.replaceForUser).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('marks the account verified and consumes the OTP on a correct code', async () => {
      const user = buildUser({ isVerified: false });
      users.findByEmail.mockResolvedValue(user);
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));

      await service.verifyOtp(user.email, '123456');

      expect(users.markVerified).toHaveBeenCalledWith(user.id);
      expect(otps.deleteForUser).toHaveBeenCalledWith(user.id);
      expect(otps.recordFailedAttempt).not.toHaveBeenCalled();
    });

    it('records a failed attempt and rejects a wrong code', async () => {
      const user = buildUser({ isVerified: false });
      users.findByEmail.mockResolvedValue(user);
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));
      otps.recordFailedAttempt.mockResolvedValue(1);

      await expect(service.verifyOtp(user.email, '000000')).rejects.toBeInstanceOf(BadRequestError);
      expect(otps.recordFailedAttempt).toHaveBeenCalledTimes(1);
      expect(users.markVerified).not.toHaveBeenCalled();
      // Below the cap the OTP is kept so the user can retry.
      expect(otps.deleteForUser).not.toHaveBeenCalled();
    });

    it('burns the OTP once the attempt cap is reached', async () => {
      const user = buildUser({ isVerified: false });
      users.findByEmail.mockResolvedValue(user);
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));
      otps.recordFailedAttempt.mockResolvedValue(OTP_MAX_ATTEMPTS);

      await expect(service.verifyOtp(user.email, '000000')).rejects.toBeInstanceOf(BadRequestError);
      expect(otps.deleteForUser).toHaveBeenCalledWith(user.id);
    });

    it('rejects generically when there is no active OTP', async () => {
      const user = buildUser({ isVerified: false });
      users.findByEmail.mockResolvedValue(user);
      otps.findActiveForUser.mockResolvedValue(null);

      await expect(service.verifyOtp(user.email, '123456')).rejects.toBeInstanceOf(BadRequestError);
    });

    it('rejects generically for an unknown email (no enumeration)', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(service.verifyOtp('nobody@example.com', '123456')).rejects.toBeInstanceOf(
        BadRequestError
      );
      expect(otps.findActiveForUser).not.toHaveBeenCalled();
    });

    it('rejects generically for an already-verified account', async () => {
      users.findByEmail.mockResolvedValue(buildUser({ isVerified: true }));
      await expect(service.verifyOtp('jane.doe@example.com', '123456')).rejects.toBeInstanceOf(
        BadRequestError
      );
      expect(otps.findActiveForUser).not.toHaveBeenCalled();
    });
  });

  describe('resendOtp', () => {
    it('issues and emails a fresh OTP when eligible', async () => {
      const user = buildUser({ isVerified: false });
      users.findByEmail.mockResolvedValue(user);
      otps.findActiveForUser.mockResolvedValue(null);

      const code = await service.resendOtp(user.email);

      expect(otps.replaceForUser).toHaveBeenCalledTimes(1);
      expect(email.sendOtpEmail).toHaveBeenCalledTimes(1);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('is a silent no-op within the resend cooldown', async () => {
      const user = buildUser({ isVerified: false });
      users.findByEmail.mockResolvedValue(user);
      // An OTP was just issued (createdAt = now), so a resend is throttled.
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456', { createdAt: new Date() }));

      const code = await service.resendOtp(user.email);

      expect(code).toBeUndefined();
      expect(otps.replaceForUser).not.toHaveBeenCalled();
      expect(email.sendOtpEmail).not.toHaveBeenCalled();
    });

    it('issues a fresh OTP once the resend cooldown has elapsed', async () => {
      const user = buildUser({ isVerified: false });
      users.findByEmail.mockResolvedValue(user);
      // The active OTP was issued well past the cooldown window, so a resend proceeds.
      otps.findActiveForUser.mockResolvedValue(
        buildOtp('123456', { createdAt: new Date(Date.now() - 10 * 60 * 1000) })
      );

      const code = await service.resendOtp(user.email);

      expect(otps.replaceForUser).toHaveBeenCalledTimes(1);
      expect(email.sendOtpEmail).toHaveBeenCalledTimes(1);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('does nothing and reveals nothing for an unknown email', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(service.resendOtp('nobody@example.com')).resolves.toBeUndefined();
      expect(otps.replaceForUser).not.toHaveBeenCalled();
      expect(email.sendOtpEmail).not.toHaveBeenCalled();
    });

    it('does nothing for an already-verified account', async () => {
      users.findByEmail.mockResolvedValue(buildUser({ isVerified: true }));
      await expect(service.resendOtp('jane.doe@example.com')).resolves.toBeUndefined();
      expect(otps.replaceForUser).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const password = 'supersecret';
    let record: UserWithPassword;

    beforeEach(async () => {
      record = { ...buildUser(), password: await hashPassword(password) };
    });

    it('returns tokens and a password-free user on valid credentials', async () => {
      users.findByEmailWithPassword.mockResolvedValue(record);

      const result = await service.login({ email: record.email, password });

      expect(result.tokens.accessToken).toEqual(expect.any(String));
      expect(result.user).not.toHaveProperty('password');
      expect(result.user.email).toBe(record.email);
    });

    it('throws UnauthorizedError on wrong password', async () => {
      users.findByEmailWithPassword.mockResolvedValue(record);
      await expect(
        service.login({ email: record.email, password: 'wrong-password' })
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('throws UnauthorizedError when the user does not exist', async () => {
      users.findByEmailWithPassword.mockResolvedValue(null);
      await expect(service.login({ email: 'nobody@example.com', password })).rejects.toBeInstanceOf(
        UnauthorizedError
      );
    });

    it('throws ForbiddenError for a correct password on an unverified account', async () => {
      users.findByEmailWithPassword.mockResolvedValue({ ...record, isVerified: false });
      await expect(service.login({ email: record.email, password })).rejects.toBeInstanceOf(
        ForbiddenError
      );
      // No session is issued for an unverified account.
      expect(refreshTokens.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('atomically consumes the token and issues new ones when valid', async () => {
      refreshTokens.consumeByValidHash.mockResolvedValue('507f1f77bcf86cd799439011');

      const tokens = await service.refresh('some-refresh-token');

      expect(refreshTokens.consumeByValidHash).toHaveBeenCalledTimes(1); // old one consumed
      expect(refreshTokens.create).toHaveBeenCalledTimes(1); // new one stored
      expect(tokens.accessToken).toEqual(expect.any(String));
    });

    it('throws UnauthorizedError for an invalid/expired/already-consumed token', async () => {
      refreshTokens.consumeByValidHash.mockResolvedValue(null);
      await expect(service.refresh('bad')).rejects.toBeInstanceOf(UnauthorizedError);
      expect(refreshTokens.create).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('stores a reset token and sends an email when the user exists', async () => {
      users.findByEmail.mockResolvedValue(buildUser());

      const token = await service.forgotPassword('jane.doe@example.com');

      expect(users.setPasswordResetToken).toHaveBeenCalledTimes(1);
      expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(token).toEqual(expect.any(String)); // dev token returned outside prod
    });

    it('does nothing and reveals nothing when the user is unknown', async () => {
      users.findByEmail.mockResolvedValue(null);

      const token = await service.forgotPassword('nobody@example.com');

      expect(token).toBeUndefined();
      expect(users.setPasswordResetToken).not.toHaveBeenCalled();
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('verifyResetToken', () => {
    it('is true for a valid token and false otherwise', async () => {
      users.findByValidResetToken.mockResolvedValueOnce(buildUser());
      await expect(service.verifyResetToken('good')).resolves.toBe(true);

      users.findByValidResetToken.mockResolvedValueOnce(null);
      await expect(service.verifyResetToken('bad')).resolves.toBe(false);
    });
  });

  describe('resetPassword', () => {
    it('updates the password and revokes all sessions on a valid token', async () => {
      const user = buildUser();
      users.findByValidResetToken.mockResolvedValue(user);

      await service.resetPassword('good-token', 'brand-new-password');

      expect(users.updatePassword).toHaveBeenCalledTimes(1);
      expect(refreshTokens.deleteAllForUser).toHaveBeenCalledWith(user.id);
    });

    it('throws BadRequestError on an invalid/expired token', async () => {
      users.findByValidResetToken.mockResolvedValue(null);
      await expect(service.resetPassword('bad-token', 'brand-new-password')).rejects.toBeInstanceOf(
        BadRequestError
      );
      expect(users.updatePassword).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('deletes the presented refresh token', async () => {
      await service.logout('some-token');
      expect(refreshTokens.deleteByHash).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProfile', () => {
    it('returns the user when the id resolves', async () => {
      const user = buildUser();
      users.findById.mockResolvedValue(user);
      await expect(service.getProfile(user.id)).resolves.toEqual(user);
    });

    it('throws UnauthorizedError when the account no longer exists', async () => {
      users.findById.mockResolvedValue(null);
      await expect(service.getProfile('507f1f77bcf86cd799439011')).rejects.toBeInstanceOf(
        UnauthorizedError
      );
    });
  });
});
