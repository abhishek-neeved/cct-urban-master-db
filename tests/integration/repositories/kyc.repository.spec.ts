import { Types } from 'mongoose';
import { KycRepository } from '@modules/kyc/kyc.repository';
import type { SubmitKycInput } from '@modules/kyc/kyc.types';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

const buildSubmission = (): SubmitKycInput => ({
  aadharNumber: '123456789012',
  aadharImageKey: 'kyc-aadhar/u1/a',
  panNumber: 'ABCDE1234F',
  panImageKey: 'kyc-pan/u1/b',
  address: '221B Baker Street',
  photographKey: 'kyc-photo/u1/c',
});

describe('KycRepository (integration)', () => {
  let repository: KycRepository;
  const userId = new Types.ObjectId().toString();
  const reviewerId = new Types.ObjectId().toString();

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new KycRepository();
  });

  it('returns null when no submission exists for the user', async () => {
    await expect(repository.findByUserId(userId)).resolves.toBeNull();
  });

  it('creates a first submission as pending', async () => {
    const record = await repository.upsertSubmission(userId, buildSubmission());

    expect(record.status).toBe('pending');
    expect(record.aadharNumber).toBe('123456789012');
    expect(record.submittedAt).toBeInstanceOf(Date);
    await expect(repository.findByUserId(userId)).resolves.toEqual(record);
  });

  it('overwrites an existing submission on resubmission, clearing prior review fields', async () => {
    await repository.upsertSubmission(userId, buildSubmission());
    await repository.reject(userId, reviewerId, 'blurry photo');

    const resubmitted = await repository.upsertSubmission(userId, {
      ...buildSubmission(),
      address: 'New address',
    });

    expect(resubmitted.status).toBe('pending');
    expect(resubmitted.address).toBe('New address');
    expect(resubmitted.rejectionReason).toBeUndefined();
  });

  it('lists submissions filtered by status', async () => {
    await repository.upsertSubmission(userId, buildSubmission());
    const otherUserId = new Types.ObjectId().toString();
    await repository.upsertSubmission(otherUserId, buildSubmission());
    await repository.approve(otherUserId, reviewerId);

    const pending = await repository.findAllForReview('pending');
    const verified = await repository.findAllForReview('verified');

    expect(pending).toHaveLength(1);
    expect(pending[0].userId).toBe(userId);
    expect(verified).toHaveLength(1);
    expect(verified[0].userId).toBe(otherUserId);
  });

  it('lists every submission when no status filter is given', async () => {
    await repository.upsertSubmission(userId, buildSubmission());
    const otherUserId = new Types.ObjectId().toString();
    await repository.upsertSubmission(otherUserId, buildSubmission());

    await expect(repository.findAllForReview()).resolves.toHaveLength(2);
  });

  it('approves a submission, recording the reviewer and timestamp', async () => {
    await repository.upsertSubmission(userId, buildSubmission());

    const approved = await repository.approve(userId, reviewerId);

    expect(approved?.status).toBe('verified');
    expect(approved?.reviewedBy).toBe(reviewerId);
    expect(approved?.reviewedAt).toBeInstanceOf(Date);
  });

  it('rejects a submission, recording the reviewer, timestamp, and reason', async () => {
    await repository.upsertSubmission(userId, buildSubmission());

    const rejected = await repository.reject(userId, reviewerId, 'blurry photo');

    expect(rejected?.status).toBe('rejected');
    expect(rejected?.reviewedBy).toBe(reviewerId);
    expect(rejected?.rejectionReason).toBe('blurry photo');
  });

  it('returns null from approve/reject when no submission exists', async () => {
    await expect(repository.approve(userId, reviewerId)).resolves.toBeNull();
    await expect(repository.reject(userId, reviewerId, 'reason')).resolves.toBeNull();
  });
});
