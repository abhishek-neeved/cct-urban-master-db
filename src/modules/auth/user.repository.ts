import { UserModel, type UserRow } from './auth.model';
import { BaseRepository } from '@shared/repositories/base.repository';
import { CreateUserInput, User, UserWithPassword, toUser, toUserWithPassword } from './user.types';

export interface UpdateUserProfileInput {
  firstName?: string;
  lastName?: string;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByEmailWithPassword(email: string): Promise<UserWithPassword | null>;
  create(input: CreateUserInput): Promise<User>;
  setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findByValidResetToken(tokenHash: string): Promise<User | null>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  updateProfile(userId: string, input: UpdateUserProfileInput): Promise<User | null>;
  markVerified(userId: string): Promise<void>;
}

/**
 * MongoDB-backed user store. Inherits generic CRUD (`findById`, `create`, ...)
 * from `BaseRepository`; adds the auth-specific, password-aware lookups. The
 * domain `User` never exposes the password — that is offered only via the
 * explicit password-aware lookup below.
 */
export class UserRepository
  extends BaseRepository<UserRow, User, CreateUserInput>
  implements IUserRepository
{
  constructor() {
    super(UserModel, toUser, {
      duplicateKeyMessage: 'A user with this email already exists',
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ email: email.toLowerCase() });
  }

  async findByEmailWithPassword(email: string): Promise<UserWithPassword | null> {
    const row = await UserModel.findOne({ email: email.toLowerCase() }).lean<UserRow>();
    return row ? toUserWithPassword(row) : null;
  }

  async setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await UserModel.updateOne(
      { _id: userId },
      { passwordResetToken: tokenHash, passwordResetExpires: expiresAt }
    );
  }

  async findByValidResetToken(tokenHash: string): Promise<User | null> {
    return this.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await UserModel.updateOne(
      { _id: userId },
      { password: passwordHash, passwordResetToken: null, passwordResetExpires: null }
    );
  }

  async markVerified(userId: string): Promise<void> {
    await UserModel.updateOne({ _id: userId }, { isVerified: true });
  }

  async updateProfile(userId: string, input: UpdateUserProfileInput): Promise<User | null> {
    return this.updateById(userId, input);
  }
}
