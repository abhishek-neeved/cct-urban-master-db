import { UserRepository } from '@modules/auth/user.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

const ABSENT_ID = '000000000000000000000000';

describe('UserRepository (integration)', () => {
  let repository: UserRepository;

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new UserRepository();
  });

  const seed = (overrides: Partial<Parameters<UserRepository['create']>[0]> = {}) =>
    repository.create({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'hashed-pw',
      role: 'customer',
      ...overrides,
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
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'Ada@Example.com',
      password: 'hashed-pw',
      role: 'customer',
    });

    await expect(repository.findByEmail('ada@example.com')).resolves.not.toBeNull();

    const withPassword = await repository.findByEmailWithPassword('ada@example.com');
    expect(withPassword?.password).toBe('hashed-pw');
  });

  it('returns null from the password-aware lookup when the email is unknown', async () => {
    await expect(repository.findByEmailWithPassword('nobody@example.com')).resolves.toBeNull();
  });

  it('returns null for a missing / invalid id', async () => {
    await expect(repository.findById('not-a-uuid')).resolves.toBeNull();
    await expect(repository.findById(ABSENT_ID)).resolves.toBeNull();
  });

  it('updates the password', async () => {
    const user = await seed();

    await repository.updatePassword(user.id, 'new-hashed-pw');

    const withPassword = await repository.findByEmailWithPassword('ada@example.com');
    expect(withPassword?.password).toBe('new-hashed-pw');
  });

  it('persists the role chosen at registration (service_provider or customer)', async () => {
    const provider = await seed({ email: 'provider@example.com', role: 'service_provider' });
    const customer = await seed({ email: 'customer@example.com', role: 'customer' });

    expect(provider.role).toBe('service_provider');
    expect(customer.role).toBe('customer');
  });

  it('updates profile fields and returns the updated domain user', async () => {
    const user = await seed();

    const updated = await repository.updateProfile(user.id, { firstName: 'Grace' });

    expect(updated?.firstName).toBe('Grace');
    expect(updated?.lastName).toBe(user.lastName);
    await expect(repository.findById(user.id)).resolves.toEqual(updated);
  });

  it('returns null from updateProfile for a missing / invalid id', async () => {
    await expect(repository.updateProfile('not-a-uuid', { firstName: 'Grace' })).resolves.toBeNull();
    await expect(repository.updateProfile(ABSENT_ID, { firstName: 'Grace' })).resolves.toBeNull();
  });
});
