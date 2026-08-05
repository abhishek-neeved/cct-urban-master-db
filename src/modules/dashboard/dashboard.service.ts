import type { IUserRepository } from '@modules/auth/user.repository';
import type { KycService } from '@modules/kyc/kyc.service';
import type { CriminalRecordService } from '@modules/criminal-record/criminal-record.service';
import type { OnboardingFeeService } from '@modules/onboarding-fee/onboarding-fee.service';
import { NotFoundError } from '@utils/errors';
import type { DashboardSummary } from './dashboard.types';

/**
 * Read-only composition over the four modules a dashboard screen needs.
 * Deliberately thin: no model, no repository, no business rules of its own —
 * every field here is owned and validated by its source module. Fetches run
 * concurrently since none depends on another's result.
 */
export class DashboardService {
  constructor(
    private readonly users: IUserRepository,
    private readonly kycService: KycService,
    private readonly criminalRecordService: CriminalRecordService,
    private readonly onboardingFeeService: OnboardingFeeService
  ) {}

  async getSummary(userId: string): Promise<DashboardSummary> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    const profile = {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
    };
    if (user.role === 'customer') {
      return { user: profile };
    }

    const [kyc, criminalRecord, onboardingFee] = await Promise.all([
      this.kycService.getStatus(userId),
      this.criminalRecordService.getStatus(userId),
      this.onboardingFeeService.getStatus(userId),
    ]);

    return { user: profile, kyc, criminalRecord, onboardingFee };
  }
}
