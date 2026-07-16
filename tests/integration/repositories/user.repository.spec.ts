import { UserRepository } from '@modules/auth/user.repository';
import { hashToken } from '@utils/token.util';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('UserRepository (integration)', () => {
  let repository: UserRepository;

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new UserRepository();
  });

  const seed = () =>
    repository.create({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      password: 'hashed-pw',
    });

  it('creates a user and finds it by id (without exposing the password)', async () => {
    const created = await seed();

    expect(created.id).toBeDefined();
    expect(created).not.toHaveProperty('password');
    await expect(repository.findById(created.id)).resolves.toEqual(created);
  });

  it('creates users unverified and can mark them verified', async () => {
    const created = await seed();
    expect(created.isVerified).toBe(false);

    await repository.markVerified(created.id);

    const reread = await repository.findById(created.id);
    expect(reread?.isVerified).toBe(true);
  });

  it('lowercases email and returns the hash only via the password-aware lookup', async () => {
    await repository.create({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'Jane.Doe@Example.com',
      password: 'hashed-pw',
    });

    await expect(repository.findByEmail('jane.doe@example.com')).resolves.not.toBeNull();

    const withPassword = await repository.findByEmailWithPassword('jane.doe@example.com');
    expect(withPassword?.password).toBe('hashed-pw');
  });

  it('returns null from the password-aware lookup when the email is unknown', async () => {
    await expect(repository.findByEmailWithPassword('nobody@example.com')).resolves.toBeNull();
  });

  it('returns null for a missing / invalid id', async () => {
    await expect(repository.findById('not-an-object-id')).resolves.toBeNull();
    await expect(repository.findById('507f1f77bcf86cd799439011')).resolves.toBeNull();
  });

  it('stores a reset token and finds it only while unexpired', async () => {
    const user = await seed();
    const tokenHash = hashToken('raw-token');

    await repository.setPasswordResetToken(user.id, tokenHash, new Date(Date.now() + 60_000));
    await expect(repository.findByValidResetToken(tokenHash)).resolves.not.toBeNull();

    // Expired token must not match.
    await repository.setPasswordResetToken(user.id, tokenHash, new Date(Date.now() - 60_000));
    await expect(repository.findByValidResetToken(tokenHash)).resolves.toBeNull();
  });

  it('updates the password and clears the reset token', async () => {
    const user = await seed();
    const tokenHash = hashToken('raw-token');
    await repository.setPasswordResetToken(user.id, tokenHash, new Date(Date.now() + 60_000));

    await repository.updatePassword(user.id, 'new-hashed-pw');

    const withPassword = await repository.findByEmailWithPassword('jane.doe@example.com');
    expect(withPassword?.password).toBe('new-hashed-pw');
    await expect(repository.findByValidResetToken(tokenHash)).resolves.toBeNull();
  });
});
