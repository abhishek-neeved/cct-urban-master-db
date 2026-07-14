import { vi, type Mocked } from 'vitest';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { IRefreshTokenRepository } from '@modules/auth/refresh-token.repository';
import type { IEmailService } from '@shared/services/email.service';

// In production the forgot-password flow must NOT return the raw reset token
// (it would otherwise leak an account-takeover token to the API caller). This
// file pins isProduction = true; the main auth.service spec covers the dev path.
vi.mock('@config/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@config/env')>()),
  isProduction: true,
}));

const { AuthService } = await import('@modules/auth/auth.service');

describe('AuthService (production)', () => {
  it('forgotPassword does not return the raw token in production', async () => {
    const users = {
      findByEmail: vi.fn().mockResolvedValue({
        id: '507f1f77bcf86cd799439011',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      setPasswordResetToken: vi.fn(),
    } as unknown as Mocked<IUserRepository>;
    const refreshTokens = {} as Mocked<IRefreshTokenRepository>;
    const email = { sendPasswordResetEmail: vi.fn() } as unknown as Mocked<IEmailService>;

    const service = new AuthService(users, refreshTokens, email);
    const token = await service.forgotPassword('jane.doe@example.com');

    expect(token).toBeUndefined();
    expect(users.setPasswordResetToken).toHaveBeenCalledTimes(1);
    expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });
});
