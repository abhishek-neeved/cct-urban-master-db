import { vi, type Mocked } from 'vitest';
import { ServiceProvidersService } from '@modules/service-providers/service-providers.service';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { IKycRepository } from '@modules/kyc/kyc.repository';
import type { User } from '@modules/auth/user.types';
import type { AdminKycRecord } from '@modules/kyc/kyc.types';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'service_provider',
  serviceCategory: 'plumber',
  phoneNumber: '+919876543210',
  isVerified: true,
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2020-01-01'),
  ...overrides,
});

const buildKycRecord = (overrides: Partial<AdminKycRecord> = {}): AdminKycRecord => ({
  id: 'kyc1',
  userId: 'u1',
  status: 'verified',
  ...overrides,
});

describe('ServiceProvidersService', () => {
  let users: Mocked<Pick<IUserRepository, 'findServiceProviders'>>;
  let kyc: Mocked<Pick<IKycRepository, 'findAllForReview'>>;
  let service: ServiceProvidersService;

  beforeEach(() => {
    users = { findServiceProviders: vi.fn() };
    kyc = { findAllForReview: vi.fn() };
    service = new ServiceProvidersService(
      users as unknown as IUserRepository,
      kyc as unknown as IKycRepository
    );
  });

  it('returns only providers with verified KYC', async () => {
    users.findServiceProviders.mockResolvedValue([
      buildUser({ id: 'u1' }),
      buildUser({ id: 'u2', firstName: 'Grace' }),
    ]);
    kyc.findAllForReview.mockResolvedValue([buildKycRecord({ userId: 'u1' })]);

    const result = await service.list();

    expect(result).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', serviceCategory: 'plumber', phoneNumber: '+919876543210' },
    ]);
    expect(users.findServiceProviders).toHaveBeenCalledWith(undefined);
    expect(kyc.findAllForReview).toHaveBeenCalledWith('verified');
  });

  it('passes the category filter through to the repository', async () => {
    users.findServiceProviders.mockResolvedValue([]);

    await service.list('electrician');

    expect(users.findServiceProviders).toHaveBeenCalledWith('electrician');
  });

  it('does not query KYC when there are no matching providers', async () => {
    users.findServiceProviders.mockResolvedValue([]);

    const result = await service.list();

    expect(result).toEqual([]);
    expect(kyc.findAllForReview).not.toHaveBeenCalled();
  });

  it('returns an empty list when no provider has verified KYC', async () => {
    users.findServiceProviders.mockResolvedValue([buildUser({ id: 'u1' })]);
    kyc.findAllForReview.mockResolvedValue([]);

    const result = await service.list();

    expect(result).toEqual([]);
  });

  it('omits a provider whose KYC is not verified even if some other record exists', async () => {
    users.findServiceProviders.mockResolvedValue([buildUser({ id: 'u1' }), buildUser({ id: 'u2' })]);
    kyc.findAllForReview.mockResolvedValue([buildKycRecord({ userId: 'u2' })]);

    const result = await service.list();

    expect(result).toHaveLength(1);
  });
});
