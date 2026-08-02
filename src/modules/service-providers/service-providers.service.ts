import type { IUserRepository } from '@modules/auth/user.repository';
import type { ServiceCategory } from '@modules/auth/user.types';
import type { IKycRepository } from '@modules/kyc/kyc.repository';
import type { ServiceProviderListing } from './service-providers.types';

/**
 * Customer-facing directory — read-only composition over `auth` (who's a
 * service_provider, what they offer) and `kyc` (who's actually verified).
 * Mirrors `dashboard`'s pattern: reconstructs its dependencies rather than
 * reusing another module's `create<X>Module()`, since those only return
 * `Router`s and there's no shared service registry in this codebase.
 */
export class ServiceProvidersService {
  constructor(
    private readonly users: IUserRepository,
    private readonly kyc: IKycRepository
  ) {}

  async list(category?: ServiceCategory): Promise<ServiceProviderListing[]> {
    const providers = await this.users.findServiceProviders(category);
    if (providers.length === 0) return [];

    const verifiedRecords = await this.kyc.findAllForReview('verified');
    const verifiedUserIds = new Set(verifiedRecords.map((record) => record.userId));

    return providers
      .filter((provider) => verifiedUserIds.has(provider.id))
      .map((provider) => ({
        firstName: provider.firstName,
        lastName: provider.lastName,
        // Safe: findServiceProviders() only returns rows with serviceCategory set.
        serviceCategory: provider.serviceCategory as ServiceCategory,
        phoneNumber: provider.phoneNumber,
      }));
  }
}
