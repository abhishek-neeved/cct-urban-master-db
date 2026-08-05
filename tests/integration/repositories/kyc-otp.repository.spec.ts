import { Types } from 'mongoose';
import { KycOtpRepository } from '@modules/kyc/kyc-otp.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('KycOtpRepository (integration)', () => {
  let repository: KycOtpRepository;
  const userId = new Types.ObjectId().toString();
  const otherUserId = new Types.ObjectId().toString();

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new KycOtpRepository();
  });

  it('stores an OTP and finds the active one for a user', async () => {
    await repository.replaceForUser(userId, '9876543210', 'hash-1', new Date(Date.now() + 60_000));

    const active = await repository.findActiveForUser(userId);
    expect(active).not.toBeNull();
    expect(active?.mobileNumber).toBe('9876543210');
    expect(active?.codeHash).toBe('hash-1');
    expect(active?.attempts).toBe(0);
  });

  it('does not return an expired OTP', async () => {
    await repository.replaceForUser(
      userId,
      '9876543210',
      'hash-expired',
      new Date(Date.now() - 60_000)
    );

    await expect(repository.findActiveForUser(userId)).resolves.toBeNull();
  });

  it('keeps only a single active OTP per user (replace)', async () => {
    await repository.replaceForUser(
      userId,
      '1111111111',
      'hash-old',
      new Date(Date.now() + 60_000)
    );
    await repository.replaceForUser(
      userId,
      '2222222222',
      'hash-new',
      new Date(Date.now() + 60_000)
    );

    const active = await repository.findActiveForUser(userId);
    expect(active?.mobileNumber).toBe('2222222222');
    expect(active?.codeHash).toBe('hash-new');
  });

  it('scopes OTPs to their user', async () => {
    await repository.replaceForUser(
      userId,
      '9876543210',
      'hash-mine',
      new Date(Date.now() + 60_000)
    );

    await expect(repository.findActiveForUser(otherUserId)).resolves.toBeNull();
  });

  it('increments the attempt count and returns the new value', async () => {
    await repository.replaceForUser(userId, '9876543210', 'hash-1', new Date(Date.now() + 60_000));
    const otp = await repository.findActiveForUser(userId);

    await expect(repository.recordFailedAttempt(otp!.id)).resolves.toBe(1);
    await expect(repository.recordFailedAttempt(otp!.id)).resolves.toBe(2);

    const reread = await repository.findActiveForUser(userId);
    expect(reread?.attempts).toBe(2);
  });

  it('returns 0 when recording an attempt against a non-existent OTP', async () => {
    const absentId = '000000000000000000000000';
    await expect(repository.recordFailedAttempt(absentId)).resolves.toBe(0);
  });

  it('returns 0 for a non-ObjectId OTP id without querying the database', async () => {
    await expect(repository.recordFailedAttempt('not-an-id')).resolves.toBe(0);
  });

  it('deletes every OTP for a user', async () => {
    await repository.replaceForUser(userId, '9876543210', 'hash-1', new Date(Date.now() + 60_000));

    await repository.deleteForUser(userId);

    await expect(repository.findActiveForUser(userId)).resolves.toBeNull();
  });
});
