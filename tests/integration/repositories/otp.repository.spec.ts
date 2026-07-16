import { OtpRepository } from '@modules/auth/otp.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER = '507f1f77bcf86cd799439012';

describe('OtpRepository (integration)', () => {
  let repository: OtpRepository;

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new OtpRepository();
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

  it('deletes every OTP for a user', async () => {
    await repository.replaceForUser(USER_ID, 'hash-1', new Date(Date.now() + 60_000));
    await repository.deleteForUser(USER_ID);
    await expect(repository.findActiveForUser(USER_ID)).resolves.toBeNull();
  });
});
