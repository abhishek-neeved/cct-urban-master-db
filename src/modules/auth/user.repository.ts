import { and, eq, gt } from 'drizzle-orm';
import { publicUserColumns, usersTable, type UserRow } from '@nvcct/db-entities';
import { db } from '@shared/config/database';
import { BaseRepository } from '@shared/repositories/base.repository';
import { CreateUserInput, User, UserWithPassword, toUser, toUserWithPassword } from './user.model';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByEmailWithPassword(email: string): Promise<UserWithPassword | null>;
  create(input: CreateUserInput): Promise<User>;
  setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findByValidResetToken(tokenHash: string): Promise<User | null>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  markVerified(userId: string): Promise<void>;
}

/**
 * Postgres-backed user store. Inherits generic CRUD (`findById`, `create`, ...)
 * from `BaseRepository`; adds the auth-specific, password-aware lookups. The
 * domain `User` never exposes the password — that is offered only via the
 * explicit password-aware lookup below.
 */
export class UserRepository
  extends BaseRepository<typeof usersTable, UserRow, User, CreateUserInput>
  implements IUserRepository
{
  constructor() {
    super(db, usersTable, usersTable.id, toUser, {
      duplicateKeyMessage: 'A user with this email already exists',
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    // Postgres has no column-level `select: false`; select the explicit safe
    // column list instead of every column.
    const [row] = await this.db
      .select(publicUserColumns)
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);
    return row ? toUser(row) : null;
  }

  async findByEmailWithPassword(email: string): Promise<UserWithPassword | null> {
    const [row] = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);
    return row ? toUserWithPassword(row) : null;
  }

  async setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ passwordResetToken: tokenHash, passwordResetExpires: expiresAt })
      .where(eq(usersTable.id, userId));
  }

  async findByValidResetToken(tokenHash: string): Promise<User | null> {
    return this.findOne(
      and(
        eq(usersTable.passwordResetToken, tokenHash),
        gt(usersTable.passwordResetExpires, new Date())
      )!
    );
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ password: passwordHash, passwordResetToken: null, passwordResetExpires: null })
      .where(eq(usersTable.id, userId));
  }

  async markVerified(userId: string): Promise<void> {
    await this.db.update(usersTable).set({ isVerified: true }).where(eq(usersTable.id, userId));
  }
}
