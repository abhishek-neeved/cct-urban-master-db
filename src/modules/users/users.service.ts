import type { IUserRepository } from '@modules/auth/user.repository';
import type { ServiceCategory, User } from '@modules/auth/user.types';
import { ForbiddenError, NotFoundError } from '@utils/errors';

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
}

/**
 * Profile reads/updates that don't belong to the auth module's credential/session
 * scope. Operates on the same `User` collection as `auth` (via the same
 * `IUserRepository` contract) rather than owning a separate model — there is
 * exactly one user collection.
 */
export class UsersService {
  constructor(private readonly users: IUserRepository) {}

  async getProfile(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }
    return user;
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
    const updated = await this.users.updateProfile(userId, input);
    if (!updated) {
      throw new NotFoundError('User');
    }
    return updated;
  }

  /**
   * Editable any time from the profile page — not a one-time onboarding step.
   * Still `service_provider`-only: a `customer` never declares a service
   * category.
   */
  async setServiceCategory(userId: string, serviceCategory: ServiceCategory): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }
    if (user.role !== 'service_provider') {
      throw new ForbiddenError('Only service providers can set a service category');
    }

    const updated = await this.users.setServiceCategory(userId, serviceCategory);
    if (!updated) {
      throw new NotFoundError('User');
    }
    return updated;
  }
}
