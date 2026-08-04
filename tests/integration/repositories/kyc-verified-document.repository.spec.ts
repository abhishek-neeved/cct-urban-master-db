import { Types } from 'mongoose';
import { KycVerifiedDocumentRepository } from '@modules/kyc/kyc-verified-document.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('KycVerifiedDocumentRepository (integration)', () => {
  let repository: KycVerifiedDocumentRepository;
  const userId = new Types.ObjectId().toString();
  const otherUserId = new Types.ObjectId().toString();

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new KycVerifiedDocumentRepository();
  });

  it('reports unverified before any verification is recorded', async () => {
    await expect(repository.isVerified(userId, 'aadhar', '123456789012')).resolves.toBe(false);
  });

  it('reports verified after markVerified for the exact doc value', async () => {
    await repository.markVerified(userId, 'aadhar', '123456789012');

    await expect(repository.isVerified(userId, 'aadhar', '123456789012')).resolves.toBe(true);
  });

  it('reports unverified for a different doc value, even for the same user and doc type', async () => {
    await repository.markVerified(userId, 'aadhar', '123456789012');

    await expect(repository.isVerified(userId, 'aadhar', '999999999999')).resolves.toBe(false);
  });

  it('scopes verification to doc type — verifying aadhar does not verify pan', async () => {
    await repository.markVerified(userId, 'aadhar', '123456789012');

    await expect(repository.isVerified(userId, 'pan', '123456789012')).resolves.toBe(false);
  });

  it('scopes verification to the user', async () => {
    await repository.markVerified(userId, 'aadhar', '123456789012');

    await expect(repository.isVerified(otherUserId, 'aadhar', '123456789012')).resolves.toBe(false);
  });

  it('replaces a prior verification for the same user and doc type when re-verifying a changed number', async () => {
    await repository.markVerified(userId, 'aadhar', '111111111111');
    await repository.markVerified(userId, 'aadhar', '222222222222');

    await expect(repository.isVerified(userId, 'aadhar', '111111111111')).resolves.toBe(false);
    await expect(repository.isVerified(userId, 'aadhar', '222222222222')).resolves.toBe(true);
  });
});
