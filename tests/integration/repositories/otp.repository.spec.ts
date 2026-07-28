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
    });
    const other = await users.create({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'hashed-pw',
    });
    USER_ID = user.id;
    OTHER_USER = other.id;
  });

  it('stores an OTP and finds the active one for a user', async () => {
    await repository.replaceForUser(USER_ID, 'hash-1', new Date(Date.now() + 60_000));

    const active = await repository.findActiveForUser(USER_ID);
    expect(active).not.toBeNull();
    expect(active?.codeHash).toBe('hash-1');
    expect(active?.attempts).toBe(0);
  });

  it('does not return an expired OTP', async () => {
    await repository.replaceForUser(USER_ID, 'hash-expired', new Date(Date.now() - 60_000));
    await expect(repository.findActiveForUser(USER_ID)).resolves.toBeNull();
  });

  it('keeps only a single active OTP per user (replace)', async () => {
    await repository.replaceForUser(USER_ID, 'hash-old', new Date(Date.now() + 60_000));
    await repository.replaceForUser(USER_ID, 'hash-new', new Date(Date.now() + 60_000));

    const active = await repository.findActiveForUser(USER_ID);
    expect(active?.codeHash).toBe('hash-new');
  });

  it('scopes OTPs to their user', async () => {
    await repository.replaceForUser(USER_ID, 'hash-mine', new Date(Date.now() + 60_000));
    await expect(repository.findActiveForUser(OTHER_USER)).resolves.toBeNull();
  });

  it('increments the attempt count and returns the new value', async () => {
    await repository.replaceForUser(USER_ID, 'hash-1', new Date(Date.now() + 60_000));
    const otp = await repository.findActiveForUser(USER_ID);

    await expect(repository.recordFailedAttempt(otp!.id)).resolves.toBe(1);
    await expect(repository.recordFailedAttempt(otp!.id)).resolves.toBe(2);

    const reread = await repository.findActiveForUser(USER_ID);
    expect(reread?.attempts).toBe(2);
  });

  it('returns 0 when recording an attempt against a non-existent OTP', async () => {
    const ABSENT_ID = '000000000000000000000000';
    await expect(repository.recordFailedAttempt(ABSENT_ID)).resolves.toBe(0);
  });

  it('returns 0 for a non-ObjectId OTP id without querying the database', async () => {
    await expect(repository.recordFailedAttempt('not-an-id')).resolves.toBe(0);
  });

  it('deletes every OTP for a user', async () => {
    await repository.replaceForUser(USER_ID, 'hash-1', new Date(Date.now() + 60_000));
    await repository.deleteForUser(USER_ID);
    await expect(repository.findActiveForUser(USER_ID)).resolves.toBeNull();
  });
});
