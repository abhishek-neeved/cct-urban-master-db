import type { IServiceProfileRepository } from './service-profile.repository';
import { ServiceProfile, UpsertServiceProfileInput } from './service-profile.types';
import type { IUserRepository } from '@modules/auth/user.repository';
import { ForbiddenError } from '@utils/errors';
import { logger } from '@utils/logger';

/**
 * Service-profile reads/writes. Business logic only — no HTTP, no mongoose.
 * `service_provider`-only: a `customer` never has one of these.
 */
export class ServiceProfileService {
  constructor(
    private readonly serviceProfiles: IServiceProfileRepository,
    private readonly users: IUserRepository
  ) {}

  async getProfile(userId: string): Promise<ServiceProfile | null> {
    return this.serviceProfiles.findByUserId(userId);
  }

  async upsertProfile(userId: string, input: UpsertServiceProfileInput): Promise<ServiceProfile> {
    const user = await this.users.findById(userId);
    if (!user || user.role !== 'service_provider') {
      throw new ForbiddenError('Only service providers can set a service profile');
    }

    const updated = await this.serviceProfiles.upsert(userId, input);
    // Keep the enum mirrored on the User document — it's what the
    // customer-facing directory (@modules/service-providers) and
    // requireAbility checks read; the profile collection is the fuller
    // record (description, years of experience).
    await this.users.setServiceCategory(userId, input.category);
    logger.info('Service profile updated', { userId, category: input.category });
    return updated;
  }
}
