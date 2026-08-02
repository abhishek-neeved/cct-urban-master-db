import type { ServiceCategory, UserRow, UserRole } from './auth.model';

export type { ServiceCategory, UserRole };

/** Domain representation returned to callers — never includes the password. */
export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  serviceCategory: ServiceCategory | null;
  phoneNumber: string | null;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Domain user plus the password hash, for internal auth checks only. */
export type UserWithPassword = User & { password: string };

/** Input to persist a new user (password is already hashed by the service). Role is set directly from the signup account-type choice — `admin` is never self-registered. */
export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: Exclude<UserRole, 'admin'>;
}

/** The fields `toUser` needs — satisfied by a full `UserRow`. */
type PublicUserRow = Pick<
  UserRow,
  | '_id'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'role'
  | 'serviceCategory'
  | 'phoneNumber'
  | 'isVerified'
  | 'createdAt'
  | 'updatedAt'
>;

export const toUser = (row: PublicUserRow): User => ({
  id: String(row._id),
  firstName: row.firstName,
  lastName: row.lastName,
  email: row.email,
  role: row.role,
  serviceCategory: row.serviceCategory,
  phoneNumber: row.phoneNumber,
  isVerified: row.isVerified,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const toUserWithPassword = (row: UserRow): UserWithPassword => ({
  ...toUser(row),
  password: row.password,
});
