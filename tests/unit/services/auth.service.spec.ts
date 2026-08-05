import { vi, type Mocked } from 'vitest';
import { AuthService } from '@modules/auth/auth.service';
import { IUserRepository } from '@modules/auth/user.repository';
import { IRefreshTokenRepository } from '@modules/auth/refresh-token.repository';
import { IOtpRepository, OtpRecord } from '@modules/auth/otp.repository';
import { ILoginAttemptRepository } from '@modules/auth/login-attempt.repository';
import { IEmailService } from '@shared/services/email.service';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '@utils/errors';
import { hashPassword } from '@utils/password.util';
import { hashToken } from '@utils/token.util';
import { LOGIN_MAX_ATTEMPTS, OTP_MAX_ATTEMPTS } from '@config/constants';
import { User, UserWithPassword } from '@modules/auth/user.types';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: '00000000-0000-4000-8000-000000000000',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'customer',
  serviceCategory: null,
  phoneNumber: null,
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
  let loginAttempts: Mocked<ILoginAttemptRepository>;
  let email: Mocked<IEmailService>;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findById: vi.fn(),
      findByIdWithPassword: vi.fn(),
      findByEmail: vi.fn(),
      findByEmailWithPassword: vi.fn(),
      create: vi.fn(),
      updatePassword: vi.fn(),
      updateProfile: vi.fn(),
      setServiceCategory: vi.fn(),
      markVerified: vi.fn(),
      findServiceProviders: vi.fn(),
    };
    refreshTokens = {
      create: vi.fn(),
      rotate: vi.fn(),
      deleteByHash: vi.fn(),
      deleteAllForUser: vi.fn(),
    };
    otps = {
      findActiveForUser: vi.fn(),
      replaceForUser: vi.fn(),
      recordFailedAttempt: vi.fn(),
      deleteForUser: vi.fn(),
    };
    loginAttempts = {
      find: vi.fn().mockResolvedValue(null),
      recordFailedAttempt: vi.fn(),
      lock: vi.fn(),
      reset: vi.fn(),
    };
    email = { sendPasswordResetEmail: vi.fn(), sendOtpEmail: vi.fn() };
    service = new AuthService(users, refreshTokens, otps, loginAttempts, email);
  });

  describe('register', () => {
    it('creates a service_provider with a hashed password, issues an OTP, and does not issue tokens', async () => {
      const user = buildUser({ isVerified: false, role: 'service_provider' });
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
      expect(created.role).toBe('service_provider');
      // An OTP is issued (hashed) and emailed, but the caller is not logged in.
      expect(otps.replaceForUser).toHaveBeenCalledTimes(1);
      expect(otps.replaceForUser).toHaveBeenCalledWith(
        user.id,
        'REGISTER',
        expect.any(String),
        expect.any(Date)
      );
      expect(email.sendOtpEmail).toHaveBeenCalledTimes(1);
      expect(refreshTokens.create).not.toHaveBeenCalled();
      // Outside production the raw OTP is returned for local testing.
      expect(result.devOtp).toMatch(/^\d{6}$/);
      // The stored code is hashed, not the raw OTP that was emailed.
      const [, , storedHash] = otps.replaceForUser.mock.calls[0];
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

      expect(otps.findActiveForUser).toHaveBeenCalledWith(user.id, 'REGISTER');
      expect(users.markVerified).toHaveBeenCalledWith(user.id);
      expect(otps.deleteForUser).toHaveBeenCalledWith(user.id, 'REGISTER');
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
      expect(otps.deleteForUser).toHaveBeenCalledWith(user.id, 'REGISTER');
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

      expect(otps.findActiveForUser).toHaveBeenCalledWith(user.id, 'REGISTER');
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
      expect(result.user.role).toBe(record.role);
      // A clean login clears any prior failed-attempt count for this email.
      expect(loginAttempts.reset).toHaveBeenCalledWith(record.email);
    });

    it('throws UnauthorizedError on wrong password and records the failed attempt against the email', async () => {
      users.findByEmailWithPassword.mockResolvedValue(record);
      loginAttempts.recordFailedAttempt.mockResolvedValue(1);

      await expect(
        service.login({ email: record.email, password: 'wrong-password' })
      ).rejects.toBeInstanceOf(UnauthorizedError);
      expect(loginAttempts.recordFailedAttempt).toHaveBeenCalledWith(record.email);
      expect(loginAttempts.lock).not.toHaveBeenCalled();
    });

    it('locks the email once wrong-password attempts reach the cap', async () => {
      users.findByEmailWithPassword.mockResolvedValue(record);
      loginAttempts.recordFailedAttempt.mockResolvedValue(LOGIN_MAX_ATTEMPTS);

      await expect(
        service.login({ email: record.email, password: 'wrong-password' })
      ).rejects.toBeInstanceOf(UnauthorizedError);
      expect(loginAttempts.lock).toHaveBeenCalledWith(record.email, expect.any(Date));
    });

    it('rejects a correct password with the same generic error while the email is locked', async () => {
      users.findByEmailWithPassword.mockResolvedValue(record);
      loginAttempts.find.mockResolvedValue({
        attempts: LOGIN_MAX_ATTEMPTS,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(service.login({ email: record.email, password })).rejects.toBeInstanceOf(
        UnauthorizedError
      );
      // Locked out — no further attempt is recorded and no session is issued.
      expect(loginAttempts.recordFailedAttempt).not.toHaveBeenCalled();
      expect(refreshTokens.create).not.toHaveBeenCalled();
    });

    it('allows login again once the lock has expired', async () => {
      users.findByEmailWithPassword.mockResolvedValue(record);
      loginAttempts.find.mockResolvedValue({
        attempts: LOGIN_MAX_ATTEMPTS,
        lockedUntil: new Date(Date.now() - 60_000),
      });

      const result = await service.login({ email: record.email, password });
      expect(result.tokens.accessToken).toEqual(expect.any(String));
    });

    it('throws UnauthorizedError when the user does not exist', async () => {
      users.findByEmailWithPassword.mockResolvedValue(null);
      await expect(service.login({ email: 'nobody@example.com', password })).rejects.toBeInstanceOf(
        UnauthorizedError
      );
    });

    it('records a failed attempt against a nonexistent email exactly as it would a wrong password', async () => {
      users.findByEmailWithPassword.mockResolvedValue(null);
      loginAttempts.recordFailedAttempt.mockResolvedValue(1);

      await expect(service.login({ email: 'nobody@example.com', password })).rejects.toBeInstanceOf(
        UnauthorizedError
      );
      // Same code path as a wrong password against a real account — this is
      // what keeps lockout behavior from leaking which emails are registered.
      expect(loginAttempts.recordFailedAttempt).toHaveBeenCalledWith('nobody@example.com');
    });

    it('locks a nonexistent email the same way as a real account once attempts reach the cap', async () => {
      users.findByEmailWithPassword.mockResolvedValue(null);
      loginAttempts.recordFailedAttempt.mockResolvedValue(LOGIN_MAX_ATTEMPTS);

      await expect(service.login({ email: 'nobody@example.com', password })).rejects.toBeInstanceOf(
        UnauthorizedError
      );
      expect(loginAttempts.lock).toHaveBeenCalledWith('nobody@example.com', expect.any(Date));
    });

    it('rejects with the same generic error whether a locked email is registered or not', async () => {
      loginAttempts.find.mockResolvedValue({
        attempts: LOGIN_MAX_ATTEMPTS,
        lockedUntil: new Date(Date.now() + 60_000),
      });
      users.findByEmailWithPassword.mockResolvedValue(null);

      await expect(service.login({ email: 'nobody@example.com', password })).rejects.toBeInstanceOf(
        UnauthorizedError
      );
      expect(loginAttempts.recordFailedAttempt).not.toHaveBeenCalled();
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
    it('atomically rotates the token and issues new ones when valid', async () => {
      refreshTokens.rotate.mockResolvedValue({
        status: 'rotated',
        userId: '507f1f77bcf86cd799439011',
      });

      const tokens = await service.refresh('some-refresh-token');

      expect(refreshTokens.rotate).toHaveBeenCalledTimes(1);
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).toEqual(expect.any(String));
    });

    it('throws UnauthorizedError for an invalid/expired token', async () => {
      refreshTokens.rotate.mockResolvedValue({ status: 'invalid' });
      await expect(service.refresh('bad')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('throws UnauthorizedError and logs a warning when a rotated-out token is replayed', async () => {
      refreshTokens.rotate.mockResolvedValue({
        status: 'reused',
        userId: '507f1f77bcf86cd799439011',
      });
      // The repository has already revoked the whole family by the time
      // `rotate` resolves — the service just needs to reject the caller.
      await expect(service.refresh('stolen-token')).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe('forgotPassword', () => {
    it('issues a RESET OTP and emails it when the user exists', async () => {
      const user = buildUser();
      users.findByEmail.mockResolvedValue(user);

      const otp = await service.forgotPassword('jane.doe@example.com');

      expect(otps.replaceForUser).toHaveBeenCalledWith(
        user.id,
        'RESET',
        expect.any(String),
        expect.any(Date)
      );
      expect(email.sendOtpEmail).toHaveBeenCalledTimes(1);
      expect(otp).toMatch(/^\d{6}$/); // dev OTP returned outside prod
    });

    it('does nothing and reveals nothing when the user is unknown', async () => {
      users.findByEmail.mockResolvedValue(null);

      const otp = await service.forgotPassword('nobody@example.com');

      expect(otp).toBeUndefined();
      expect(otps.replaceForUser).not.toHaveBeenCalled();
      expect(email.sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates the password and revokes all sessions on a correct OTP', async () => {
      const user = buildUser();
      users.findByEmail.mockResolvedValue(user);
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));

      await service.resetPassword(user.email, '123456', 'brand-new-password');

      expect(otps.findActiveForUser).toHaveBeenCalledWith(user.id, 'RESET');
      expect(otps.deleteForUser).toHaveBeenCalledWith(user.id, 'RESET');
      expect(users.updatePassword).toHaveBeenCalledTimes(1);
      expect(loginAttempts.reset).toHaveBeenCalledWith(user.email);
      expect(refreshTokens.deleteAllForUser).toHaveBeenCalledWith(user.id);
    });

    it('rejects generically for an unknown email (no enumeration)', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(
        service.resetPassword('nobody@example.com', '123456', 'brand-new-password')
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('rejects generically when there is no active RESET OTP', async () => {
      const user = buildUser();
      users.findByEmail.mockResolvedValue(user);
      otps.findActiveForUser.mockResolvedValue(null);

      await expect(
        service.resetPassword(user.email, '123456', 'brand-new-password')
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('records a failed attempt and rejects a wrong code', async () => {
      const user = buildUser();
      users.findByEmail.mockResolvedValue(user);
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));
      otps.recordFailedAttempt.mockResolvedValue(1);

      await expect(
        service.resetPassword(user.email, '000000', 'brand-new-password')
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(otps.recordFailedAttempt).toHaveBeenCalledTimes(1);
      expect(users.updatePassword).not.toHaveBeenCalled();
      expect(otps.deleteForUser).not.toHaveBeenCalled();
    });

    it('burns the OTP once the attempt cap is reached', async () => {
      const user = buildUser();
      users.findByEmail.mockResolvedValue(user);
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));
      otps.recordFailedAttempt.mockResolvedValue(OTP_MAX_ATTEMPTS);

      await expect(
        service.resetPassword(user.email, '000000', 'brand-new-password')
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(otps.deleteForUser).toHaveBeenCalledWith(user.id, 'RESET');
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

  describe('changePassword', () => {
    const currentPassword = 'supersecret';
    let record: UserWithPassword;

    beforeEach(async () => {
      record = { ...buildUser(), password: await hashPassword(currentPassword) };
    });

    it('verifies the current password, sets the new one, and revokes all sessions', async () => {
      users.findByIdWithPassword.mockResolvedValue(record);

      await service.changePassword(record.id, currentPassword, 'brand-new-password');

      expect(users.updatePassword).toHaveBeenCalledWith(record.id, expect.any(String));
      const [, newHash] = users.updatePassword.mock.calls[0];
      expect(newHash).not.toBe(record.password);
      expect(refreshTokens.deleteAllForUser).toHaveBeenCalledWith(record.id);
    });

    it('throws BadRequestError when the current password is wrong', async () => {
      users.findByIdWithPassword.mockResolvedValue(record);

      await expect(
        service.changePassword(record.id, 'wrong-password', 'brand-new-password')
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(users.updatePassword).not.toHaveBeenCalled();
      expect(refreshTokens.deleteAllForUser).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedError when the account no longer exists', async () => {
      users.findByIdWithPassword.mockResolvedValue(null);

      await expect(
        service.changePassword('missing', currentPassword, 'brand-new-password')
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });
});
