import { vi, type Mocked } from 'vitest';
import { AuthService } from '@modules/auth/auth.service';
import { IUserRepository } from '@modules/auth/user.repository';
import { IRefreshTokenRepository } from '@modules/auth/refresh-token.repository';
import { IEmailService } from '@shared/services/email.service';
import { BadRequestError, ConflictError, UnauthorizedError } from '@utils/errors';
import { hashPassword } from '@utils/password.util';
import { User, UserWithPassword } from '@modules/auth/user.model';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: '507f1f77bcf86cd799439011',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2020-01-01'),
  ...overrides,
});

describe('AuthService', () => {
  let users: Mocked<IUserRepository>;
  let refreshTokens: Mocked<IRefreshTokenRepository>;
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
    };
    refreshTokens = {
      create: vi.fn(),
      findUserIdByValidHash: vi.fn(),
      consumeByValidHash: vi.fn(),
      deleteByHash: vi.fn(),
      deleteAllForUser: vi.fn(),
    };
    email = { sendPasswordResetEmail: vi.fn() };
    service = new AuthService(users, refreshTokens, email);
  });

  describe('register', () => {
    it('creates a user, hashes the password, and issues tokens', async () => {
      const user = buildUser();
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(user);

      const result = await service.register({
        name: user.name,
        email: user.email,
        password: 'supersecret',
      });

      expect(result.user).toEqual(user);
      expect(result.tokens.accessToken).toEqual(expect.any(String));
      expect(result.tokens.refreshToken).toEqual(expect.any(String));
      // Password passed to the repository must be hashed, not plaintext.
      const created = users.create.mock.calls[0][0];
      expect(created.password).not.toBe('supersecret');
      expect(refreshTokens.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a duplicate email with ConflictError', async () => {
      users.findByEmail.mockResolvedValue(buildUser());
      await expect(
        service.register({ name: 'X', email: 'ada@example.com', password: 'supersecret' })
      ).rejects.toBeInstanceOf(ConflictError);
      expect(users.create).not.toHaveBeenCalled();
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

      const token = await service.forgotPassword('ada@example.com');

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
