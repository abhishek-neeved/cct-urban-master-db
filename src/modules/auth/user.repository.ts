import {
  CreateUserInput,
  User,
  UserAttrs,
  UserModel,
  UserWithPassword,
  toUser,
  toUserWithPassword,
} from './user.model';
import { BaseRepository } from '@shared/repositories/base.repository';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByEmailWithPassword(email: string): Promise<UserWithPassword | null>;
  create(input: CreateUserInput): Promise<User>;
  setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findByValidResetToken(tokenHash: string): Promise<User | null>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
}

/**
 * MongoDB-backed user store. Inherits generic CRUD (`findById`, `create`, ...)
 * from `BaseRepository`; adds the auth-specific, password-aware lookups. The
 * domain `User` never exposes the password — that is offered only via the
 * explicit password-aware lookup below.
 */
export class UserRepository
  extends BaseRepository<UserAttrs, User, CreateUserInput>
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
    // The password field is `select: false`, so it must be requested explicitly
    // and mapped with the password-aware mapper.
    const doc = await this.model.findOne({ email: email.toLowerCase() }).select('+password').exec();
    return doc ? toUserWithPassword(doc) : null;
  }

  async setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.model
      .findByIdAndUpdate(userId, {
        passwordResetToken: tokenHash,
        passwordResetExpires: expiresAt,
      })
      .exec();
  }

  async findByValidResetToken(tokenHash: string): Promise<User | null> {
    return this.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.model
      .findByIdAndUpdate(userId, {
        password: passwordHash,
        $unset: { passwordResetToken: 1, passwordResetExpires: 1 },
      })
      .exec();
  }
}
