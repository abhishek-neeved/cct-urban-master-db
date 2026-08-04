import { Types } from 'mongoose';
import { KycVerificationOtpRepository } from '@modules/kyc/kyc-verification-otp.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('KycVerificationOtpRepository (integration)', () => {
  let repository: KycVerificationOtpRepository;
  const userId = new Types.ObjectId().toString();
  const otherUserId = new Types.ObjectId().toString();

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new KycVerificationOtpRepository();
  });

  it('stores an OTP and finds the active one for a user and doc type', async () => {
    await repository.replaceForUser(
      userId,
      'aadhar',
      '123456789012',
      'hash-1',
      new Date(Date.now() + 60_000)
    );

    const active = await repository.findActiveForUser(userId, 'aadhar');
    expect(active).not.toBeNull();
    expect(active?.docValue).toBe('123456789012');
    expect(active?.codeHash).toBe('hash-1');
    expect(active?.attempts).toBe(0);
  });

  it('does not return an expired OTP', async () => {
    await repository.replaceForUser(
      userId,
      'aadhar',
      '123456789012',
      'hash-expired',
      new Date(Date.now() - 60_000)
    );
    await expect(repository.findActiveForUser(userId, 'aadhar')).resolves.toBeNull();
  });

  it('keeps only a single active OTP per user per doc type (replace)', async () => {
    await repository.replaceForUser(
      userId,
      'aadhar',
      '111111111111',
      'hash-old',
      new Date(Date.now() + 60_000)
    );
    await repository.replaceForUser(
      userId,
      'aadhar',
      '222222222222',
      'hash-new',
      new Date(Date.now() + 60_000)
    );

    const active = await repository.findActiveForUser(userId, 'aadhar');
    expect(active?.docValue).toBe('222222222222');
    expect(active?.codeHash).toBe('hash-new');
  });

  it('scopes OTPs to their user', async () => {
    await repository.replaceForUser(
      userId,
      'aadhar',
      '123456789012',
      'hash-mine',
      new Date(Date.now() + 60_000)
    );
    await expect(repository.findActiveForUser(otherUserId, 'aadhar')).resolves.toBeNull();
  });

  it('keeps an aadhar OTP and a pan OTP for the same user independent', async () => {
    await repository.replaceForUser(
      userId,
      'aadhar',
      '123456789012',
      'hash-aadhar',
      new Date(Date.now() + 60_000)
    );
    await repository.replaceForUser(
      userId,
      'pan',
      'ABCDE1234F',
      'hash-pan',
      new Date(Date.now() + 60_000)
    );

    await expect(repository.findActiveForUser(userId, 'aadhar')).resolves.toMatchObject({
      codeHash: 'hash-aadhar',
    });
    await expect(repository.findActiveForUser(userId, 'pan')).resolves.toMatchObject({
      codeHash: 'hash-pan',
    });

    await repository.deleteForUser(userId, 'aadhar');
    await expect(repository.findActiveForUser(userId, 'aadhar')).resolves.toBeNull();
    await expect(repository.findActiveForUser(userId, 'pan')).resolves.not.toBeNull();
  });

  it('increments the attempt count and returns the new value', async () => {
    await repository.replaceForUser(
      userId,
      'aadhar',
      '123456789012',
      'hash-1',
      new Date(Date.now() + 60_000)
    );
    const otp = await repository.findActiveForUser(userId, 'aadhar');

    await expect(repository.recordFailedAttempt(otp!.id)).resolves.toBe(1);
    await expect(repository.recordFailedAttempt(otp!.id)).resolves.toBe(2);

    const reread = await repository.findActiveForUser(userId, 'aadhar');
    expect(reread?.attempts).toBe(2);
  });

  it('returns 0 when recording an attempt against a non-existent OTP', async () => {
    const absentId = '000000000000000000000000';
    await expect(repository.recordFailedAttempt(absentId)).resolves.toBe(0);
  });

  it('returns 0 for a non-ObjectId OTP id without querying the database', async () => {
    await expect(repository.recordFailedAttempt('not-an-id')).resolves.toBe(0);
  });

  it('deletes every OTP for a user and doc type', async () => {
    await repository.replaceForUser(
      userId,
      'aadhar',
      '123456789012',
      'hash-1',
      new Date(Date.now() + 60_000)
    );
    await repository.deleteForUser(userId, 'aadhar');
    await expect(repository.findActiveForUser(userId, 'aadhar')).resolves.toBeNull();
  });
});
