import { RefreshTokenRepository } from '@modules/auth/refresh-token.repository';
import { UserRepository } from '@modules/auth/user.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('RefreshTokenRepository (integration)', () => {
  let repository: RefreshTokenRepository;
  let users: UserRepository;
  let userId: string;

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(async () => {
    repository = new RefreshTokenRepository();
    users = new UserRepository();
    // refresh_tokens.user_id is a real foreign key to users.id, so every test
    // needs an actual persisted user to attach tokens to.
    const user = await users.create({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'hashed-pw',
    });
    userId = user.id;
  });

  it('stores a token and resolves the user id for a valid hash', async () => {
    await repository.create(userId, 'hash-1', new Date(Date.now() + 60_000));
    await expect(repository.findUserIdByValidHash('hash-1')).resolves.toBe(userId);
  });

  it('does not resolve an expired token', async () => {
    await repository.create(userId, 'hash-expired', new Date(Date.now() - 60_000));
    await expect(repository.findUserIdByValidHash('hash-expired')).resolves.toBeNull();
  });

  it('deletes a single token by hash (rotation / logout)', async () => {
    await repository.create(userId, 'hash-2', new Date(Date.now() + 60_000));
    await repository.deleteByHash('hash-2');
    await expect(repository.findUserIdByValidHash('hash-2')).resolves.toBeNull();
  });

  it('atomically consumes a valid token exactly once', async () => {
    await repository.create(userId, 'hash-consume', new Date(Date.now() + 60_000));

    await expect(repository.consumeByValidHash('hash-consume')).resolves.toBe(userId);
    // A second consume of the same (now deleted) token wins nothing.
    await expect(repository.consumeByValidHash('hash-consume')).resolves.toBeNull();
  });

  it('does not consume an expired token', async () => {
    await repository.create(userId, 'hash-old', new Date(Date.now() - 60_000));
    await expect(repository.consumeByValidHash('hash-old')).resolves.toBeNull();
  });

  it('deletes all tokens for a user (password reset / global logout)', async () => {
    await repository.create(userId, 'hash-a', new Date(Date.now() + 60_000));
    await repository.create(userId, 'hash-b', new Date(Date.now() + 60_000));

    await repository.deleteAllForUser(userId);

    await expect(repository.findUserIdByValidHash('hash-a')).resolves.toBeNull();
    await expect(repository.findUserIdByValidHash('hash-b')).resolves.toBeNull();
  });
});
