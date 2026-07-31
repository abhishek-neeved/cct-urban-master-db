import { vi, type Mocked } from 'vitest';
import { UsersService } from '@modules/users/users.service';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { User } from '@modules/auth/user.types';
import { NotFoundError } from '@utils/errors';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: '00000000-0000-4000-8000-000000000000',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'user',
  isVerified: true,
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2020-01-01'),
  ...overrides,
});

describe('UsersService', () => {
  let users: Mocked<IUserRepository>;
  let service: UsersService;

  beforeEach(() => {
    users = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      findByEmailWithPassword: vi.fn(),
      create: vi.fn(),
      setPasswordResetToken: vi.fn(),
      findByValidResetToken: vi.fn(),
      updatePassword: vi.fn(),
      updateProfile: vi.fn(),
      markVerified: vi.fn(),
    };
    service = new UsersService(users);
  });

  describe('getProfile', () => {
    it('returns the user when found', async () => {
      const user = buildUser();
      users.findById.mockResolvedValue(user);

      await expect(service.getProfile(user.id)).resolves.toEqual(user);
    });

    it('throws NotFoundError when the user no longer exists', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.getProfile('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateProfile', () => {
    it('updates and returns the profile', async () => {
      const updated = buildUser({ firstName: 'Grace' });
      users.updateProfile.mockResolvedValue(updated);

      const result = await service.updateProfile(updated.id, { firstName: 'Grace' });

      expect(users.updateProfile).toHaveBeenCalledWith(updated.id, { firstName: 'Grace' });
      expect(result).toEqual(updated);
    });

    it('throws NotFoundError when the user no longer exists', async () => {
      users.updateProfile.mockResolvedValue(null);

      await expect(service.updateProfile('missing', { firstName: 'Grace' })).rejects.toThrow(
        NotFoundError
      );
    });
  });
});
