import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import {
  UserModel,
  OtpModel,
  RefreshTokenModel,
  LoginAttemptModel,
} from '@modules/auth/auth.model';

let mongod: MongoMemoryServer | null = null;

/** Spin up an isolated in-memory MongoDB and connect Mongoose to it. */
export const connectTestDb = async (): Promise<void> => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Build unique indexes up front so duplicate-key assertions are reliable
  // from the very first test (Mongoose otherwise builds them in the
  // background after connecting).
  await Promise.all([
    UserModel.init(),
    OtpModel.init(),
    RefreshTokenModel.init(),
    LoginAttemptModel.init(),
  ]);
};

/** Wipe every collection between tests so each case starts clean. */
export const clearTestDb = async (): Promise<void> => {
  await RefreshTokenModel.deleteMany({});
  await OtpModel.deleteMany({});
  await UserModel.deleteMany({});
  await LoginAttemptModel.deleteMany({});
};

/** Tear down the connection. */
export const closeTestDb = async (): Promise<void> => {
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
};
