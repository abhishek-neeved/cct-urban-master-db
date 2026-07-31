import type { UserRow, UserRole } from './auth.model';

export type { UserRole };

/** Domain representation returned to callers — never includes the password. */
export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Domain user plus the password hash, for internal auth checks only. */
export type UserWithPassword = User & { password: string };

/** Input to persist a new user (password is already hashed by the service). */
export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

/** The fields `toUser` needs — satisfied by a full `UserRow`. */
type PublicUserRow = Pick<
  UserRow,
  '_id' | 'firstName' | 'lastName' | 'email' | 'role' | 'isVerified' | 'createdAt' | 'updatedAt'
>;

export const toUser = (row: PublicUserRow): User => ({
  id: String(row._id),
  firstName: row.firstName,
  lastName: row.lastName,
  email: row.email,
  role: row.role,
  isVerified: row.isVerified,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const toUserWithPassword = (row: UserRow): UserWithPassword => ({
  ...toUser(row),
  password: row.password,
});
