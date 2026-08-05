import { vi, type Mocked } from 'vitest';
import { DashboardService } from '@modules/dashboard/dashboard.service';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { KycService } from '@modules/kyc/kyc.service';
import type { CriminalRecordService } from '@modules/criminal-record/criminal-record.service';
import type { OnboardingFeeService } from '@modules/onboarding-fee/onboarding-fee.service';
import type { User } from '@modules/auth/user.types';
import { NotFoundError } from '@utils/errors';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
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

describe('DashboardService', () => {
  let users: Mocked<Pick<IUserRepository, 'findById'>>;
  let kycService: Mocked<Pick<KycService, 'getStatus'>>;
  let criminalRecordService: Mocked<Pick<CriminalRecordService, 'getStatus'>>;
  let onboardingFeeService: Mocked<Pick<OnboardingFeeService, 'getStatus'>>;
  let service: DashboardService;

  beforeEach(() => {
    users = { findById: vi.fn() };
    kycService = { getStatus: vi.fn() };
    criminalRecordService = { getStatus: vi.fn() };
    onboardingFeeService = { getStatus: vi.fn() };
    service = new DashboardService(
      users as unknown as IUserRepository,
      kycService as unknown as KycService,
      criminalRecordService as unknown as CriminalRecordService,
      onboardingFeeService as unknown as OnboardingFeeService
    );
  });

  it('composes the profile, KYC, criminal-record, and onboarding-fee status for a service provider', async () => {
    users.findById.mockResolvedValue(buildUser({ role: 'service_provider' }));
    kycService.getStatus.mockResolvedValue({ status: 'verified' });
    criminalRecordService.getStatus.mockResolvedValue({ status: 'clear' });
    onboardingFeeService.getStatus.mockResolvedValue({ status: 'unpaid', amountInRupees: 10 });

    const summary = await service.getSummary('u1');

    expect(summary).toEqual({
      user: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        role: 'service_provider',
      },
      kyc: { status: 'verified' },
      criminalRecord: { status: 'clear' },
      onboardingFee: { status: 'unpaid', amountInRupees: 10 },
    });
    expect(users.findById).toHaveBeenCalledWith('u1');
    expect(kycService.getStatus).toHaveBeenCalledWith('u1');
    expect(criminalRecordService.getStatus).toHaveBeenCalledWith('u1');
    expect(onboardingFeeService.getStatus).toHaveBeenCalledWith('u1');
  });

  it('omits KYC/criminal-record/onboarding-fee for a customer, and never calls those services', async () => {
    users.findById.mockResolvedValue(buildUser({ role: 'customer' }));

    const summary = await service.getSummary('u1');

    expect(summary).toEqual({
      user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', role: 'customer' },
    });
    expect(kycService.getStatus).not.toHaveBeenCalled();
    expect(criminalRecordService.getStatus).not.toHaveBeenCalled();
    expect(onboardingFeeService.getStatus).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the user no longer exists', async () => {
    users.findById.mockResolvedValue(null);

    await expect(service.getSummary('missing')).rejects.toThrow(NotFoundError);
  });
});
