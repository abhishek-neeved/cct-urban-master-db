import { vi, type Mocked } from 'vitest';
import { ServiceProfileService } from '@modules/service-profile/service-profile.service';
import type { IServiceProfileRepository } from '@modules/service-profile/service-profile.repository';
import type { ServiceProfile } from '@modules/service-profile/service-profile.types';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { User } from '@modules/auth/user.types';
import { ForbiddenError } from '@utils/errors';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'service_provider',
  serviceCategory: null,
  phoneNumber: null,
  isVerified: true,
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2020-01-01'),
  ...overrides,
});

const buildProfile = (overrides: Partial<ServiceProfile> = {}): ServiceProfile => ({
  category: 'plumber',
  description: null,
  yearsOfExperience: null,
  ...overrides,
});

describe('ServiceProfileService', () => {
  let serviceProfiles: Mocked<IServiceProfileRepository>;
  let users: Mocked<Pick<IUserRepository, 'findById' | 'setServiceCategory'>>;
  let service: ServiceProfileService;

  beforeEach(() => {
    serviceProfiles = { findByUserId: vi.fn(), upsert: vi.fn() };
    users = { findById: vi.fn(), setServiceCategory: vi.fn() };
    service = new ServiceProfileService(serviceProfiles, users as unknown as IUserRepository);
  });

  describe('getProfile', () => {
    it('returns the stored profile', async () => {
      const profile = buildProfile();
      serviceProfiles.findByUserId.mockResolvedValue(profile);

      await expect(service.getProfile('u1')).resolves.toEqual(profile);
    });

    it('returns null when no profile has been set yet', async () => {
      serviceProfiles.findByUserId.mockResolvedValue(null);

      await expect(service.getProfile('u1')).resolves.toBeNull();
    });
  });

  describe('upsertProfile', () => {
    it('creates/updates the profile and mirrors the category onto the User document', async () => {
      users.findById.mockResolvedValue(buildUser());
      const updated = buildProfile({ category: 'electrician', description: 'Wiring and repairs' });
      serviceProfiles.upsert.mockResolvedValue(updated);

      const result = await service.upsertProfile('u1', {
        category: 'electrician',
        description: 'Wiring and repairs',
      });

      expect(serviceProfiles.upsert).toHaveBeenCalledWith('u1', {
        category: 'electrician',
        description: 'Wiring and repairs',
      });
      expect(users.setServiceCategory).toHaveBeenCalledWith('u1', 'electrician');
      expect(result).toEqual(updated);
    });

    it('throws ForbiddenError when the user no longer exists', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.upsertProfile('u1', { category: 'plumber' })).rejects.toThrow(
        ForbiddenError
      );
      expect(serviceProfiles.upsert).not.toHaveBeenCalled();
    });

    it('throws ForbiddenError for a customer', async () => {
      users.findById.mockResolvedValue(buildUser({ role: 'customer' }));

      await expect(service.upsertProfile('u1', { category: 'plumber' })).rejects.toThrow(
        ForbiddenError
      );
      expect(serviceProfiles.upsert).not.toHaveBeenCalled();
    });

    it('throws ForbiddenError for an admin', async () => {
      users.findById.mockResolvedValue(buildUser({ role: 'admin' }));

      await expect(service.upsertProfile('u1', { category: 'plumber' })).rejects.toThrow(
        ForbiddenError
      );
      expect(serviceProfiles.upsert).not.toHaveBeenCalled();
    });
  });
});
