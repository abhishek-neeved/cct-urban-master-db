import { vi, type Mocked } from 'vitest';
import { KycService } from '@modules/kyc/kyc.service';
import type { IKycRepository } from '@modules/kyc/kyc.repository';
import type { KycVerificationService } from '@modules/kyc/kyc-verification.service';
import type { AdminKycRecord, KycRecord, SubmitKycInput } from '@modules/kyc/kyc.types';
import { BadRequestError, NotFoundError } from '@utils/errors';

const buildSubmission = (): SubmitKycInput => ({
  aadharNumber: '123456789012',
  panNumber: 'ABCDE1234F',
  address: '221B Baker Street',
});

const buildRecord = (overrides: Partial<KycRecord> = {}): KycRecord => ({
  status: 'pending',
  submittedAt: new Date('2020-01-01'),
  ...overrides,
});

const buildAdminRecord = (overrides: Partial<AdminKycRecord> = {}): AdminKycRecord => ({
  id: 'kyc1',
  userId: 'u1',
  status: 'pending',
  submittedAt: new Date('2020-01-01'),
  ...overrides,
});

describe('KycService', () => {
  let kyc: Mocked<IKycRepository>;
  let verification: Mocked<Pick<KycVerificationService, 'isAadharVerified' | 'isPanVerified'>>;
  let service: KycService;

  beforeEach(() => {
    kyc = {
      findByUserId: vi.fn(),
      upsertSubmission: vi.fn(),
      findAllForReview: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    };
    verification = {
      isAadharVerified: vi.fn().mockResolvedValue(true),
      isPanVerified: vi.fn().mockResolvedValue(true),
    };
    service = new KycService(kyc, verification as unknown as KycVerificationService);
  });

  describe('getStatus', () => {
    it('returns "not_started" when no record exists', async () => {
      kyc.findByUserId.mockResolvedValue(null);

      await expect(service.getStatus('u1')).resolves.toEqual({ status: 'not_started' });
    });

    it('returns the stored record when one exists', async () => {
      const record = buildRecord();
      kyc.findByUserId.mockResolvedValue(record);

      await expect(service.getStatus('u1')).resolves.toEqual(record);
    });
  });

  describe('submit', () => {
    it('creates a fresh submission when no record exists and both docs are verified', async () => {
      kyc.findByUserId.mockResolvedValue(null);
      const created = buildRecord();
      kyc.upsertSubmission.mockResolvedValue(created);

      const result = await service.submit('u1', buildSubmission());

      expect(verification.isAadharVerified).toHaveBeenCalledWith('u1', '123456789012');
      expect(verification.isPanVerified).toHaveBeenCalledWith('u1', 'ABCDE1234F');
      expect(kyc.upsertSubmission).toHaveBeenCalledWith('u1', buildSubmission());
      expect(result).toEqual(created);
    });

    it('allows resubmission after a rejection', async () => {
      kyc.findByUserId.mockResolvedValue(buildRecord({ status: 'rejected' }));
      kyc.upsertSubmission.mockResolvedValue(buildRecord({ status: 'pending' }));

      await expect(service.submit('u1', buildSubmission())).resolves.toEqual(
        buildRecord({ status: 'pending' })
      );
    });

    it('rejects resubmission while already verified', async () => {
      kyc.findByUserId.mockResolvedValue(buildRecord({ status: 'verified' }));

      await expect(service.submit('u1', buildSubmission())).rejects.toThrow(BadRequestError);
      expect(kyc.upsertSubmission).not.toHaveBeenCalled();
    });

    it('rejects resubmission while already pending', async () => {
      kyc.findByUserId.mockResolvedValue(buildRecord({ status: 'pending' }));

      await expect(service.submit('u1', buildSubmission())).rejects.toThrow(BadRequestError);
      expect(kyc.upsertSubmission).not.toHaveBeenCalled();
    });

    it('rejects when the Aadhaar number has not been verified', async () => {
      kyc.findByUserId.mockResolvedValue(null);
      verification.isAadharVerified.mockResolvedValue(false);

      await expect(service.submit('u1', buildSubmission())).rejects.toThrow(BadRequestError);
      expect(kyc.upsertSubmission).not.toHaveBeenCalled();
    });

    it('rejects when the PAN has not been verified', async () => {
      kyc.findByUserId.mockResolvedValue(null);
      verification.isPanVerified.mockResolvedValue(false);

      await expect(service.submit('u1', buildSubmission())).rejects.toThrow(BadRequestError);
      expect(kyc.upsertSubmission).not.toHaveBeenCalled();
    });
  });

  describe('listForReview', () => {
    it('passes the status filter through to the repository', async () => {
      const records = [buildAdminRecord()];
      kyc.findAllForReview.mockResolvedValue(records);

      await expect(service.listForReview('pending')).resolves.toEqual(records);
      expect(kyc.findAllForReview).toHaveBeenCalledWith('pending');
    });

    it('lists every status when no filter is given', async () => {
      kyc.findAllForReview.mockResolvedValue([]);

      await service.listForReview();

      expect(kyc.findAllForReview).toHaveBeenCalledWith(undefined);
    });
  });

  describe('approve', () => {
    it('approves a pending submission', async () => {
      kyc.findByUserId.mockResolvedValue(buildRecord({ status: 'pending' }));
      const approved = buildAdminRecord({ status: 'verified' });
      kyc.approve.mockResolvedValue(approved);

      await expect(service.approve('u1', 'admin1')).resolves.toEqual(approved);
      expect(kyc.approve).toHaveBeenCalledWith('u1', 'admin1');
    });

    it('throws NotFoundError when no submission exists', async () => {
      kyc.findByUserId.mockResolvedValue(null);

      await expect(service.approve('u1', 'admin1')).rejects.toThrow(NotFoundError);
      expect(kyc.approve).not.toHaveBeenCalled();
    });

    it('throws BadRequestError when the submission is not pending', async () => {
      kyc.findByUserId.mockResolvedValue(buildRecord({ status: 'verified' }));

      await expect(service.approve('u1', 'admin1')).rejects.toThrow(BadRequestError);
      expect(kyc.approve).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects a pending submission with a reason', async () => {
      kyc.findByUserId.mockResolvedValue(buildRecord({ status: 'pending' }));
      const rejected = buildAdminRecord({ status: 'rejected', rejectionReason: 'blurry photo' });
      kyc.reject.mockResolvedValue(rejected);

      await expect(service.reject('u1', 'admin1', 'blurry photo')).resolves.toEqual(rejected);
      expect(kyc.reject).toHaveBeenCalledWith('u1', 'admin1', 'blurry photo');
    });

    it('throws NotFoundError when no submission exists', async () => {
      kyc.findByUserId.mockResolvedValue(null);

      await expect(service.reject('u1', 'admin1', 'reason')).rejects.toThrow(NotFoundError);
      expect(kyc.reject).not.toHaveBeenCalled();
    });

    it('throws BadRequestError when the submission is not pending', async () => {
      kyc.findByUserId.mockResolvedValue(buildRecord({ status: 'rejected' }));

      await expect(service.reject('u1', 'admin1', 'reason')).rejects.toThrow(BadRequestError);
      expect(kyc.reject).not.toHaveBeenCalled();
    });
  });
});
