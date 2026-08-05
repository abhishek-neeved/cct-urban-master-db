import { Types } from 'mongoose';
import { KycModel } from '@modules/kyc/kyc.model';
import { KycRepository } from '@modules/kyc/kyc.repository';
import type { SubmitKycInput } from '@modules/kyc/kyc.types';
import type { MobileToPanResult } from '@shared/services/mobile-verification.service';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

const buildSubmission = (): SubmitKycInput => ({
  addressLine: '221B Baker Street',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
});

const buildLookup = (overrides: Partial<MobileToPanResult> = {}): MobileToPanResult => ({
  pan_number: 'ABCDE1234F',
  full_name: 'Test User',
  masked_aadhaar: 'XXXXXXXX9012',
  address: { full: '221B Baker Street' },
  ...overrides,
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

  describe('findByUserId', () => {
    it('returns null when no row exists for the user', async () => {
      await expect(repository.findByUserId(userId)).resolves.toBeNull();
    });

    it('returns the mapped record once a row exists', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());

      const record = await repository.findByUserId(userId);

      expect(record).toEqual(
        expect.objectContaining({
          status: 'not_started',
          mobileVerified: true,
          mobileNumber: '9876543210',
        })
      );
    });

    it('maps every nullable field to undefined when the row has none of them set', async () => {
      // Bypasses the repository (which always sets mobileNumber via
      // setMobileVerified) to exercise toKycRecord's `?? undefined` mapping
      // for a row that still has its schema defaults (nulls) throughout.
      await KycModel.create({ userId, status: 'not_started' });

      const record = await repository.findByUserId(userId);

      expect(record).toEqual({
        status: 'not_started',
        mobileNumber: undefined,
        mobileVerified: false,
        aadharNumber: undefined,
        aadhaarVerified: false,
        panNumber: undefined,
        panVerified: false,
        addressLine: undefined,
        city: undefined,
        state: undefined,
        pincode: undefined,
        submittedAt: undefined,
        rejectionReason: undefined,
      });
    });
  });

  describe('findRowByUserId', () => {
    it('returns null when no row exists for the user', async () => {
      await expect(repository.findRowByUserId(userId)).resolves.toBeNull();
    });

    it('returns the raw row once one exists', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());

      const row = await repository.findRowByUserId(userId);

      expect(row).not.toBeNull();
      expect(row?.userId.toString()).toBe(userId);
      expect(row?.mobileNumber).toBe('9876543210');
      expect(row?.mobileVerified).toBe(true);
      expect(row?.mobileLookup).toEqual(buildLookup());
    });
  });

  describe('setMobileVerified', () => {
    it('creates the row on the first call, defaulting status to not_started, and caches the lookup verbatim', async () => {
      const lookup = buildLookup();
      const record = await repository.setMobileVerified(userId, '9876543210', lookup);

      expect(record.status).toBe('not_started');
      expect(record.mobileVerified).toBe(true);
      expect(record.mobileNumber).toBe('9876543210');
      const row = await repository.findRowByUserId(userId);
      expect(row?.mobileLookup).toEqual(lookup);
    });

    it('updates the mobile number and replaces the cached lookup on a second call for a different number', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());

      const newLookup = buildLookup({ pan_number: 'ZZZZZ9999Z' });
      const updated = await repository.setMobileVerified(userId, '9999999999', newLookup);

      expect(updated.mobileNumber).toBe('9999999999');
      expect(updated.mobileVerified).toBe(true);
      await expect(repository.findByUserId(userId)).resolves.toEqual(
        expect.objectContaining({ mobileNumber: '9999999999' })
      );
      const row = await repository.findRowByUserId(userId);
      expect(row?.mobileLookup).toEqual(newLookup);
    });

    it('does not create a second row for the same user (upserts on the unique userId)', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());
      await repository.setMobileVerified(userId, '9999999999', buildLookup());

      const row = await repository.findRowByUserId(userId);
      expect(row).not.toBeNull();
    });

    it('resets aadhaarVerified/panVerified to false when the mobile number is re-verified with a different number', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());
      await repository.setAadhaarVerified(userId, '123456789012');
      await repository.setPanVerified(userId, 'ABCDE1234F');

      const reverified = await repository.setMobileVerified(userId, '9999999999', buildLookup());

      // The prior Aadhaar/PAN checks were made against the old number's
      // lookup — they no longer apply once the mobile number changes.
      expect(reverified.aadhaarVerified).toBe(false);
      expect(reverified.panVerified).toBe(false);
      await expect(repository.findByUserId(userId)).resolves.toEqual(
        expect.objectContaining({ aadhaarVerified: false, panVerified: false })
      );
    });

    it('resets aadhaarVerified/panVerified to false even when the SAME mobile number is re-verified (its lookup may have changed)', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());
      await repository.setAadhaarVerified(userId, '123456789012');
      await repository.setPanVerified(userId, 'ABCDE1234F');

      const reverified = await repository.setMobileVerified(
        userId,
        '9876543210',
        buildLookup({ pan_number: 'ZZZZZ9999Z' })
      );

      expect(reverified.aadhaarVerified).toBe(false);
      expect(reverified.panVerified).toBe(false);
    });
  });

  describe('setAadhaarVerified', () => {
    it('sets the Aadhaar number and flag once the row already exists', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());

      const record = await repository.setAadhaarVerified(userId, '123456789012');

      expect(record.aadhaarVerified).toBe(true);
      expect(record.aadharNumber).toBe('123456789012');
    });

    it('rejects when the row does not exist yet (no upsert)', async () => {
      await expect(repository.setAadhaarVerified(userId, '123456789012')).rejects.toThrow();
    });
  });

  describe('setPanVerified', () => {
    it('sets the PAN number and flag once the row already exists', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());

      const record = await repository.setPanVerified(userId, 'ABCDE1234F');

      expect(record.panVerified).toBe(true);
      expect(record.panNumber).toBe('ABCDE1234F');
    });

    it('rejects when the row does not exist yet (no upsert)', async () => {
      await expect(repository.setPanVerified(userId, 'ABCDE1234F')).rejects.toThrow();
    });
  });

  describe('submit', () => {
    it('moves the row to verified, stamping submittedAt and clearing any prior review trail', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());
      await repository.setAadhaarVerified(userId, '123456789012');
      await repository.setPanVerified(userId, 'ABCDE1234F');
      await repository.reject(userId, reviewerId, 'blurry photo');

      const submitted = await repository.submit(userId, buildSubmission());

      expect(submitted.status).toBe('verified');
      expect(submitted.addressLine).toBe('221B Baker Street');
      expect(submitted.city).toBe('Mumbai');
      expect(submitted.state).toBe('Maharashtra');
      expect(submitted.pincode).toBe('400001');
      expect(submitted.submittedAt).toBeInstanceOf(Date);
      expect(submitted.rejectionReason).toBeUndefined();
    });
  });

  describe('findAllForReview', () => {
    it('excludes not_started rows by default', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());
      const otherUserId = new Types.ObjectId().toString();
      await repository.setMobileVerified(otherUserId, '9999999999', buildLookup());
      await repository.setAadhaarVerified(otherUserId, '123456789012');
      await repository.setPanVerified(otherUserId, 'ABCDE1234F');
      await repository.submit(otherUserId, buildSubmission());

      const all = await repository.findAllForReview();

      expect(all).toHaveLength(1);
      expect(all[0].userId).toBe(otherUserId);
      expect(all[0].status).toBe('verified');
    });

    it('filters by an explicit status', async () => {
      // submit() always yields 'verified' now (see KycRepository.submit) —
      // 'pending' is still a valid status value (kept for the admin
      // review methods' possible future manual-re-review use) but nothing
      // in the normal flow produces it anymore, so it's seeded directly
      // here to verify findAllForReview's status filter still honors it.
      await repository.setMobileVerified(userId, '9876543210', buildLookup());
      await repository.setAadhaarVerified(userId, '123456789012');
      await repository.setPanVerified(userId, 'ABCDE1234F');
      await repository.submit(userId, buildSubmission());
      await KycModel.findOneAndUpdate({ userId }, { status: 'pending' });
      const otherUserId = new Types.ObjectId().toString();
      await repository.setMobileVerified(otherUserId, '9999999999', buildLookup());
      await repository.setAadhaarVerified(otherUserId, '123456789012');
      await repository.setPanVerified(otherUserId, 'ABCDE1234F');
      await repository.submit(otherUserId, buildSubmission());

      const pending = await repository.findAllForReview('pending');
      const verified = await repository.findAllForReview('verified');

      expect(pending).toHaveLength(1);
      expect(pending[0].userId).toBe(userId);
      expect(verified).toHaveLength(1);
      expect(verified[0].userId).toBe(otherUserId);
    });
  });

  describe('approve', () => {
    it('approves a submission, recording the reviewer and timestamp', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());
      await repository.setAadhaarVerified(userId, '123456789012');
      await repository.setPanVerified(userId, 'ABCDE1234F');
      await repository.submit(userId, buildSubmission());

      const approved = await repository.approve(userId, reviewerId);

      expect(approved?.status).toBe('verified');
      expect(approved?.reviewedBy).toBe(reviewerId);
      expect(approved?.reviewedAt).toBeInstanceOf(Date);
    });

    it('returns null when no row exists for the user', async () => {
      await expect(repository.approve(userId, reviewerId)).resolves.toBeNull();
    });
  });

  describe('reject', () => {
    it('rejects a submission, recording the reviewer, timestamp, and reason', async () => {
      await repository.setMobileVerified(userId, '9876543210', buildLookup());
      await repository.setAadhaarVerified(userId, '123456789012');
      await repository.setPanVerified(userId, 'ABCDE1234F');
      await repository.submit(userId, buildSubmission());

      const rejected = await repository.reject(userId, reviewerId, 'blurry photo');

      expect(rejected?.status).toBe('rejected');
      expect(rejected?.reviewedBy).toBe(reviewerId);
      expect(rejected?.rejectionReason).toBe('blurry photo');
    });

    it('returns null when no row exists for the user', async () => {
      await expect(repository.reject(userId, reviewerId, 'reason')).resolves.toBeNull();
    });
  });
});
