import type { IUserRepository } from '@modules/auth/user.repository';
import type { User } from '@modules/auth/user.types';
import { NotFoundError } from '@utils/errors';

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
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
}
