import { RefreshTokenRepository } from '@modules/auth/refresh-token.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

const USER_ID = '507f1f77bcf86cd799439011';

describe('RefreshTokenRepository (integration)', () => {
  let repository: RefreshTokenRepository;

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new RefreshTokenRepository();
  });

  it('stores a token and resolves the user id for a valid hash', async () => {
    await repository.create(USER_ID, 'hash-1', new Date(Date.now() + 60_000));
    await expect(repository.findUserIdByValidHash('hash-1')).resolves.toBe(USER_ID);
  });

  it('does not resolve an expired token', async () => {
    await repository.create(USER_ID, 'hash-expired', new Date(Date.now() - 60_000));
    await expect(repository.findUserIdByValidHash('hash-expired')).resolves.toBeNull();
  });

  it('deletes a single token by hash (rotation / logout)', async () => {
    await repository.create(USER_ID, 'hash-2', new Date(Date.now() + 60_000));
    await repository.deleteByHash('hash-2');
    await expect(repository.findUserIdByValidHash('hash-2')).resolves.toBeNull();
  });

  it('atomically consumes a valid token exactly once', async () => {
    await repository.create(USER_ID, 'hash-consume', new Date(Date.now() + 60_000));

    await expect(repository.consumeByValidHash('hash-consume')).resolves.toBe(USER_ID);
    // A second consume of the same (now deleted) token wins nothing.
    await expect(repository.consumeByValidHash('hash-consume')).resolves.toBeNull();
  });

  it('does not consume an expired token', async () => {
    await repository.create(USER_ID, 'hash-old', new Date(Date.now() - 60_000));
    await expect(repository.consumeByValidHash('hash-old')).resolves.toBeNull();
  });

  it('deletes all tokens for a user (password reset / global logout)', async () => {
    await repository.create(USER_ID, 'hash-a', new Date(Date.now() + 60_000));
    await repository.create(USER_ID, 'hash-b', new Date(Date.now() + 60_000));

    await repository.deleteAllForUser(USER_ID);

    await expect(repository.findUserIdByValidHash('hash-a')).resolves.toBeNull();
    await expect(repository.findUserIdByValidHash('hash-b')).resolves.toBeNull();
  });
});
