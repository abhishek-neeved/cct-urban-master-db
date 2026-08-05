import { OtpRepository } from '@modules/auth/otp.repository';
import { UserRepository } from '@modules/auth/user.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('OtpRepository (integration)', () => {
  let repository: OtpRepository;
  let users: UserRepository;
  let USER_ID: string;
  let OTHER_USER: string;

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(async () => {
    repository = new OtpRepository();
    users = new UserRepository();
    // otps.user_id is a real foreign key to users.id, so every test needs
    // actual persisted users to attach OTPs to.
    const user = await users.create({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'hashed-pw',
      role: 'customer',
    });
    const other = await users.create({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'hashed-pw',
      role: 'customer',
    });
    USER_ID = user.id;
    OTHER_USER = other.id;
  });

  it('stores an OTP and finds the active one for a user', async () => {
    await repository.replaceForUser(USER_ID, 'REGISTER', 'hash-1', new Date(Date.now() + 60_000));

    const active = await repository.findActiveForUser(USER_ID, 'REGISTER');
    expect(active).not.toBeNull();
    expect(active?.codeHash).toBe('hash-1');
    expect(active?.attempts).toBe(0);
  });

  it('does not return an expired OTP', async () => {
    await repository.replaceForUser(USER_ID, 'REGISTER', 'hash-expired', new Date(Date.now() - 60_000));
    await expect(repository.findActiveForUser(USER_ID, 'REGISTER')).resolves.toBeNull();
  });

  it('keeps only a single active OTP per user per type (replace)', async () => {
    await repository.replaceForUser(USER_ID, 'REGISTER', 'hash-old', new Date(Date.now() + 60_000));
    await repository.replaceForUser(USER_ID, 'REGISTER', 'hash-new', new Date(Date.now() + 60_000));

    const active = await repository.findActiveForUser(USER_ID, 'REGISTER');
    expect(active?.codeHash).toBe('hash-new');
  });

  it('scopes OTPs to their user', async () => {
    await repository.replaceForUser(USER_ID, 'REGISTER', 'hash-mine', new Date(Date.now() + 60_000));
    await expect(repository.findActiveForUser(OTHER_USER, 'REGISTER')).resolves.toBeNull();
  });

  it('keeps a REGISTER OTP and a RESET OTP for the same user independent', async () => {
    await repository.replaceForUser(USER_ID, 'REGISTER', 'hash-register', new Date(Date.now() + 60_000));
    await repository.replaceForUser(USER_ID, 'RESET', 'hash-reset', new Date(Date.now() + 60_000));

    await expect(repository.findActiveForUser(USER_ID, 'REGISTER')).resolves.toMatchObject({
      codeHash: 'hash-register',
    });
    await expect(repository.findActiveForUser(USER_ID, 'RESET')).resolves.toMatchObject({
      codeHash: 'hash-reset',
    });

    // Deleting one flow's OTP must not touch the other's.
    await repository.deleteForUser(USER_ID, 'REGISTER');
    await expect(repository.findActiveForUser(USER_ID, 'REGISTER')).resolves.toBeNull();
    await expect(repository.findActiveForUser(USER_ID, 'RESET')).resolves.not.toBeNull();
  });

  it('increments the attempt count and returns the new value', async () => {
    await repository.replaceForUser(USER_ID, 'REGISTER', 'hash-1', new Date(Date.now() + 60_000));
    const otp = await repository.findActiveForUser(USER_ID, 'REGISTER');

    await expect(repository.recordFailedAttempt(otp!.id)).resolves.toBe(1);
    await expect(repository.recordFailedAttempt(otp!.id)).resolves.toBe(2);

    const reread = await repository.findActiveForUser(USER_ID, 'REGISTER');
    expect(reread?.attempts).toBe(2);
  });

  it('returns 0 when recording an attempt against a non-existent OTP', async () => {
    const ABSENT_ID = '000000000000000000000000';
    await expect(repository.recordFailedAttempt(ABSENT_ID)).resolves.toBe(0);
  });

  it('returns 0 for a non-ObjectId OTP id without querying the database', async () => {
    await expect(repository.recordFailedAttempt('not-an-id')).resolves.toBe(0);
  });

  it('deletes every OTP for a user and type', async () => {
    await repository.replaceForUser(USER_ID, 'REGISTER', 'hash-1', new Date(Date.now() + 60_000));
    await repository.deleteForUser(USER_ID, 'REGISTER');
    await expect(repository.findActiveForUser(USER_ID, 'REGISTER')).resolves.toBeNull();
  });
});
