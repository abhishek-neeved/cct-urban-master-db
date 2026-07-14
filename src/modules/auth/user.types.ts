import type { IUser, UserDocument } from '@nvcct/db-entities';

/** Domain representation returned to callers — never includes the password. */
export interface User extends Pick<
  IUser,
  'firstName' | 'lastName' | 'email' | 'createdAt' | 'updatedAt'
> {
  id: string;
}

/** Domain user plus the password hash, for internal auth checks only. */
export type UserWithPassword = User & Pick<IUser, 'password'>;

/** Input to persist a new user (password is already hashed by the service). */
export type CreateUserInput = Pick<IUser, 'firstName' | 'lastName' | 'email' | 'password'>;

export const toUser = (doc: UserDocument): User => ({
  id: doc._id.toString(),
  firstName: doc.firstName,
  lastName: doc.lastName,
  email: doc.email,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

export const toUserWithPassword = (doc: UserDocument): UserWithPassword => ({
  ...toUser(doc),
  password: doc.password,
});
