import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo: MongoMemoryServer | null = null;

/** Spin up an isolated in-memory MongoDB and connect Mongoose to it. */
export const connectTestDb = async (): Promise<void> => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
};

/** Wipe every collection between tests so each case starts clean. */
export const clearTestDb = async (): Promise<void> => {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
};

/** Tear down the connection and stop the in-memory server. */
export const closeTestDb = async (): Promise<void> => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongo) {
    await mongo.stop();
    mongo = null;
  }
};
