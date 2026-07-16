import { vi, type Mocked } from 'vitest';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { IRefreshTokenRepository } from '@modules/auth/refresh-token.repository';
import type { IOtpRepository } from '@modules/auth/otp.repository';
import type { IEmailService } from '@shared/services/email.service';

// In production the flows that mint a raw secret (reset token, verification OTP)
// must NOT return it to the API caller — that would leak an account-takeover /
// verification secret. This file pins isProduction = true; the main
// auth.service spec covers the dev path where the raw values are returned.
vi.mock('@config/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@config/env')>()),
  isProduction: true,
}));

const { AuthService } = await import('@modules/auth/auth.service');

const buildUser = () => ({
  id: '507f1f77bcf86cd799439011',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
  isVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('AuthService (production)', () => {
  it('forgotPassword does not return the raw token in production', async () => {
    const users = {
      findByEmail: vi.fn().mockResolvedValue(buildUser()),
      setPasswordResetToken: vi.fn(),
    } as unknown as Mocked<IUserRepository>;
    const refreshTokens = {} as Mocked<IRefreshTokenRepository>;
    const otps = {} as Mocked<IOtpRepository>;
    const email = {
      sendPasswordResetEmail: vi.fn(),
      sendOtpEmail: vi.fn(),
    } as unknown as Mocked<IEmailService>;

    const service = new AuthService(users, refreshTokens, otps, email);
    const token = await service.forgotPassword('jane.doe@example.com');

    expect(token).toBeUndefined();
    expect(users.setPasswordResetToken).toHaveBeenCalledTimes(1);
    expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('register does not return the raw OTP in production', async () => {
    const created = buildUser();
    const users = {
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(created),
    } as unknown as Mocked<IUserRepository>;
    const refreshTokens = {} as Mocked<IRefreshTokenRepository>;
    const otps = { replaceForUser: vi.fn() } as unknown as Mocked<IOtpRepository>;
    const email = {
      sendPasswordResetEmail: vi.fn(),
      sendOtpEmail: vi.fn(),
    } as unknown as Mocked<IEmailService>;

    const service = new AuthService(users, refreshTokens, otps, email);
    const result = await service.register({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      password: 'supersecret',
    });

    // The OTP is still issued and emailed, but never returned to the caller.
    expect(result.devOtp).toBeUndefined();
    expect(otps.replaceForUser).toHaveBeenCalledTimes(1);
    expect(email.sendOtpEmail).toHaveBeenCalledTimes(1);
  });

  it('resendOtp does not return the raw OTP in production', async () => {
    const users = {
      findByEmail: vi.fn().mockResolvedValue(buildUser()),
    } as unknown as Mocked<IUserRepository>;
    const refreshTokens = {} as Mocked<IRefreshTokenRepository>;
    const otps = {
      findActiveForUser: vi.fn().mockResolvedValue(null),
      replaceForUser: vi.fn(),
    } as unknown as Mocked<IOtpRepository>;
    const email = {
      sendPasswordResetEmail: vi.fn(),
      sendOtpEmail: vi.fn(),
    } as unknown as Mocked<IEmailService>;

    const service = new AuthService(users, refreshTokens, otps, email);
    const code = await service.resendOtp('jane.doe@example.com');

    expect(code).toBeUndefined();
    expect(email.sendOtpEmail).toHaveBeenCalledTimes(1);
  });
});
