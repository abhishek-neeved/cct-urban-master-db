import { Schema, model, HydratedDocument } from 'mongoose';

/** Domain representation returned to callers — never includes the password. */
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Domain user plus the password hash, for internal auth checks only. */
export type UserWithPassword = User & { password: string };

/** Input to persist a new user (password is already hashed by the service). */
export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
}

export interface UserAttrs {
  name: string;
  email: string;
  password: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<UserAttrs>;

const userSchema = new Schema<UserAttrs>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // `select: false` keeps these out of query results unless explicitly asked for.
    password: { type: String, required: true, select: false },
    passwordResetToken: { type: String, select: false, index: true },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

export const UserModel = model<UserAttrs>('User', userSchema);

export const toUser = (doc: UserDocument): User => ({
  id: doc._id.toString(),
  name: doc.name,
  email: doc.email,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

export const toUserWithPassword = (doc: UserDocument): UserWithPassword => ({
  ...toUser(doc),
  password: doc.password,
});
