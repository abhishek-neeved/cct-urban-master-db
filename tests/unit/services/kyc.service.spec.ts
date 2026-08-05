import { vi, type Mocked } from 'vitest';
import type { IKycRepository } from '@modules/kyc/kyc.repository';
import type { KycRow } from '@modules/kyc/kyc.model';
import type { IKycOtpRepository, KycOtpRecord } from '@modules/kyc/kyc-otp.repository';
import type {
  IMobileVerificationProvider,
  MobileToPanResult,
} from '@shared/services/mobile-verification.service';
import type { AdminKycRecord, KycRecord, SubmitKycInput } from '@modules/kyc/kyc.types';
import { hashToken } from '@utils/token.util';
import { BadRequestError, NotFoundError } from '@utils/errors';
import { OTP_MAX_ATTEMPTS } from '@config/constants';

// Mutable production flag, mirroring the pattern used elsewhere in this repo
// (e.g. the deleted kyc-verification-provider.service.spec.ts,
// email.service.spec.ts) for exercising `isProduction`'s branch explicitly
// rather than relying on the real env default.
const state = vi.hoisted(() => ({ isProduction: false }));
vi.mock('@config/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@config/env')>()),
  get isProduction() {
    return state.isProduction;
  },
}));

const { KycService } = await import('@modules/kyc/kyc.service');

const buildOtp = (code: string, overrides: Partial<KycOtpRecord> = {}): KycOtpRecord => ({
  id: '507f1f77bcf86cd799439099',
  mobileNumber: '9876543210',
  codeHash: hashToken(code),
  attempts: 0,
  createdAt: new Date('2020-01-01'),
  ...overrides,
});

const buildRecord = (overrides: Partial<KycRecord> = {}): KycRecord => ({
  status: 'not_started',
  mobileVerified: false,
  aadhaarVerified: false,
  panVerified: false,
  ...overrides,
});

const buildAdminRecord = (overrides: Partial<AdminKycRecord> = {}): AdminKycRecord => ({
  id: 'kyc1',
  userId: 'u1',
  status: 'pending',
  mobileVerified: true,
  aadhaarVerified: true,
  panVerified: true,
  ...overrides,
});

const buildLookup = (overrides: Partial<MobileToPanResult> = {}): MobileToPanResult => ({
  pan_number: 'ABCDE1234F',
  full_name: 'Test User',
  masked_aadhaar: 'XXXXXXXX9012',
  address: { full: '221B Baker Street' },
  ...overrides,
});

// `requireMobileLookup` reads the raw row (via `findRowByUserId`), not the
// mapped `KycRecord` — this fixture is intentionally row-shaped (only the
// fields that guard actually inspects are required; the rest is cast away).
const buildRow = (overrides: Partial<KycRow> = {}): KycRow =>
  ({
    mobileVerified: true,
    mobileLookup: buildLookup(),
    ...overrides,
  }) as KycRow;

describe('KycService', () => {
  let kyc: Mocked<IKycRepository>;
  let otps: Mocked<IKycOtpRepository>;
  let mobileVerificationProvider: Mocked<IMobileVerificationProvider>;
  let service: InstanceType<typeof KycService>;

  beforeEach(() => {
    state.isProduction = false;
    kyc = {
      findByUserId: vi.fn(),
      findRowByUserId: vi.fn(),
      setMobileVerified: vi.fn(),
      setAadhaarVerified: vi.fn(),
      setPanVerified: vi.fn(),
      submit: vi.fn(),
      findAllForReview: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    };
    otps = {
      findActiveForUser: vi.fn(),
      replaceForUser: vi.fn(),
      recordFailedAttempt: vi.fn(),
      deleteForUser: vi.fn(),
    };
    mobileVerificationProvider = {
      lookupByMobileNumber: vi.fn(),
    };
    service = new KycService(kyc, otps, mobileVerificationProvider);
  });

  describe('getStatus', () => {
    it('returns the "not_started" default when no record exists', async () => {
      kyc.findByUserId.mockResolvedValue(null);

      await expect(service.getStatus('u1')).resolves.toEqual({
        status: 'not_started',
        mobileVerified: false,
        aadhaarVerified: false,
        panVerified: false,
      });
    });

    it('returns the stored record when one exists', async () => {
      const record = buildRecord({ status: 'pending', mobileVerified: true });
      kyc.findByUserId.mockResolvedValue(record);

      await expect(service.getStatus('u1')).resolves.toEqual(record);
    });
  });

  describe('requestMobileVerification', () => {
    it('stores a hashed OTP for the mobile number and returns the raw OTP outside production', async () => {
      const result = await service.requestMobileVerification('u1', '9876543210');

      expect(otps.replaceForUser).toHaveBeenCalledWith(
        'u1',
        '9876543210',
        expect.any(String),
        expect.any(Date)
      );
      expect(result.devOtp).toMatch(/^\d{6}$/);
      const [, , storedHash] = otps.replaceForUser.mock.calls[0];
      expect(storedHash).toBe(hashToken(result.devOtp as string));
    });

    it('never returns the OTP in production, but still stores its hash', async () => {
      state.isProduction = true;

      const result = await service.requestMobileVerification('u1', '9876543210');

      expect(result.devOtp).toBeUndefined();
      expect(otps.replaceForUser).toHaveBeenCalledWith(
        'u1',
        '9876543210',
        expect.any(String),
        expect.any(Date)
      );
    });
  });

  describe('confirmMobileOtp', () => {
    it('looks up the mobile-to-pan result once, caches it, and consumes the OTP on a correct code', async () => {
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));
      const lookup = buildLookup();
      mobileVerificationProvider.lookupByMobileNumber.mockResolvedValue(lookup);
      const updated = buildRecord({ mobileVerified: true, mobileNumber: '9876543210' });
      kyc.setMobileVerified.mockResolvedValue(updated);

      await expect(service.confirmMobileOtp('u1', '123456')).resolves.toEqual(updated);

      // Cost-optimization: the provider is called exactly once, for the
      // OTP-verified mobile number, and its result is what gets cached —
      // this is the only provider call anywhere in the KYC flow now.
      expect(mobileVerificationProvider.lookupByMobileNumber).toHaveBeenCalledTimes(1);
      expect(mobileVerificationProvider.lookupByMobileNumber).toHaveBeenCalledWith('9876543210');
      expect(kyc.setMobileVerified).toHaveBeenCalledWith('u1', '9876543210', lookup);
      expect(otps.deleteForUser).toHaveBeenCalledWith('u1');
      expect(otps.recordFailedAttempt).not.toHaveBeenCalled();
    });

    it('throws BadRequestError when there is no active OTP, without ever calling the lookup provider', async () => {
      otps.findActiveForUser.mockResolvedValue(null);

      await expect(service.confirmMobileOtp('u1', '123456')).rejects.toThrow(BadRequestError);
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setMobileVerified).not.toHaveBeenCalled();
    });

    it('records a failed attempt and throws on a wrong code, without deleting the OTP under the cap, and without calling the lookup provider', async () => {
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));
      otps.recordFailedAttempt.mockResolvedValue(1);

      await expect(service.confirmMobileOtp('u1', '000000')).rejects.toThrow(BadRequestError);

      expect(otps.recordFailedAttempt).toHaveBeenCalledWith('507f1f77bcf86cd799439099');
      expect(otps.deleteForUser).not.toHaveBeenCalled();
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setMobileVerified).not.toHaveBeenCalled();
    });

    it('deletes the OTP once the attempt cap is reached, without calling the lookup provider', async () => {
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));
      otps.recordFailedAttempt.mockResolvedValue(OTP_MAX_ATTEMPTS);

      await expect(service.confirmMobileOtp('u1', '000000')).rejects.toThrow(BadRequestError);

      expect(otps.deleteForUser).toHaveBeenCalledWith('u1');
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setMobileVerified).not.toHaveBeenCalled();
    });
  });

  describe('verifyAadhaar', () => {
    it('throws BadRequestError when no row exists yet for the user', async () => {
      kyc.findRowByUserId.mockResolvedValue(null);

      await expect(service.verifyAadhaar('u1', '123456789012')).rejects.toThrow(BadRequestError);
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setAadhaarVerified).not.toHaveBeenCalled();
    });

    it('throws BadRequestError when the row exists but the mobile number is not verified', async () => {
      kyc.findRowByUserId.mockResolvedValue(
        buildRow({ mobileVerified: false, mobileLookup: null })
      );

      await expect(service.verifyAadhaar('u1', '123456789012')).rejects.toThrow(BadRequestError);
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setAadhaarVerified).not.toHaveBeenCalled();
    });

    it('throws BadRequestError when mobileVerified is true but the lookup was never cached', async () => {
      kyc.findRowByUserId.mockResolvedValue(buildRow({ mobileVerified: true, mobileLookup: null }));

      await expect(service.verifyAadhaar('u1', '123456789012')).rejects.toThrow(BadRequestError);
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setAadhaarVerified).not.toHaveBeenCalled();
    });

    it('verifies successfully when the last 4 digits match the cached masked_aadhaar lookup, without ever calling the provider', async () => {
      kyc.findRowByUserId.mockResolvedValue(
        buildRow({ mobileLookup: buildLookup({ masked_aadhaar: 'XXXXXXXX9012' }) })
      );
      const updated = buildRecord({ aadhaarVerified: true, aadharNumber: '123456789012' });
      kyc.setAadhaarVerified.mockResolvedValue(updated);

      await expect(service.verifyAadhaar('u1', '123456789012')).resolves.toEqual(updated);

      // Cost-optimization: verifyAadhaar reads the cached lookup off the row
      // instead of re-fetching it — the provider is never called here.
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setAadhaarVerified).toHaveBeenCalledWith('u1', '123456789012');
    });

    it('throws BadRequestError when the last 4 digits do not match the cached masked_aadhaar lookup', async () => {
      kyc.findRowByUserId.mockResolvedValue(
        buildRow({ mobileLookup: buildLookup({ masked_aadhaar: 'XXXXXXXX0000' }) })
      );

      await expect(service.verifyAadhaar('u1', '123456789012')).rejects.toThrow(BadRequestError);
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setAadhaarVerified).not.toHaveBeenCalled();
    });
  });

  describe('verifyPan', () => {
    it('throws BadRequestError when no row exists yet for the user', async () => {
      kyc.findRowByUserId.mockResolvedValue(null);

      await expect(service.verifyPan('u1', 'ABCDE1234F')).rejects.toThrow(BadRequestError);
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setPanVerified).not.toHaveBeenCalled();
    });

    it('throws BadRequestError when the row exists but the mobile number is not verified', async () => {
      kyc.findRowByUserId.mockResolvedValue(
        buildRow({ mobileVerified: false, mobileLookup: null })
      );

      await expect(service.verifyPan('u1', 'ABCDE1234F')).rejects.toThrow(BadRequestError);
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setPanVerified).not.toHaveBeenCalled();
    });

    it('throws BadRequestError when mobileVerified is true but the lookup was never cached', async () => {
      kyc.findRowByUserId.mockResolvedValue(buildRow({ mobileVerified: true, mobileLookup: null }));

      await expect(service.verifyPan('u1', 'ABCDE1234F')).rejects.toThrow(BadRequestError);
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setPanVerified).not.toHaveBeenCalled();
    });

    it('verifies successfully with a case-insensitive match against the cached pan_number lookup, without ever calling the provider', async () => {
      kyc.findRowByUserId.mockResolvedValue(
        buildRow({ mobileLookup: buildLookup({ pan_number: 'abcde1234f' }) })
      );
      const updated = buildRecord({ panVerified: true, panNumber: 'ABCDE1234F' });
      kyc.setPanVerified.mockResolvedValue(updated);

      await expect(service.verifyPan('u1', 'ABCDE1234F')).resolves.toEqual(updated);

      // Cost-optimization: verifyPan reads the cached lookup off the row
      // instead of re-fetching it — the provider is never called here.
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setPanVerified).toHaveBeenCalledWith('u1', 'ABCDE1234F');
    });

    it('throws BadRequestError when the PAN does not match the cached pan_number lookup', async () => {
      kyc.findRowByUserId.mockResolvedValue(
        buildRow({ mobileLookup: buildLookup({ pan_number: 'ZZZZZ9999Z' }) })
      );

      await expect(service.verifyPan('u1', 'ABCDE1234F')).rejects.toThrow(BadRequestError);
      expect(mobileVerificationProvider.lookupByMobileNumber).not.toHaveBeenCalled();
      expect(kyc.setPanVerified).not.toHaveBeenCalled();
    });
  });

  describe('submit', () => {
    const buildInput = (): SubmitKycInput => ({
      addressLine: '221B Baker Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    });
    const fullyVerified = (): KycRecord =>
      buildRecord({ mobileVerified: true, aadhaarVerified: true, panVerified: true });

    it('submits successfully once mobile/Aadhaar/PAN are all verified', async () => {
      kyc.findByUserId.mockResolvedValue(fullyVerified());
      const updated = buildRecord({ status: 'verified', ...fullyVerified() });
      kyc.submit.mockResolvedValue(updated);

      await expect(service.submit('u1', buildInput())).resolves.toEqual(updated);
      expect(kyc.submit).toHaveBeenCalledWith('u1', buildInput());
    });

    it('rejects when already verified', async () => {
      kyc.findByUserId.mockResolvedValue(buildRecord({ ...fullyVerified(), status: 'verified' }));

      await expect(service.submit('u1', buildInput())).rejects.toThrow(BadRequestError);
      expect(kyc.submit).not.toHaveBeenCalled();
    });

    it('rejects with a mobile-specific message when the mobile number is not verified, checked before Aadhaar/PAN', async () => {
      kyc.findByUserId.mockResolvedValue(
        buildRecord({ mobileVerified: false, aadhaarVerified: false, panVerified: false })
      );

      await expect(service.submit('u1', buildInput())).rejects.toThrow(
        'Verify your mobile number before submitting'
      );
      expect(kyc.submit).not.toHaveBeenCalled();
    });

    it('rejects with an Aadhaar-specific message when Aadhaar is not verified but mobile is', async () => {
      kyc.findByUserId.mockResolvedValue(
        buildRecord({ mobileVerified: true, aadhaarVerified: false, panVerified: false })
      );

      await expect(service.submit('u1', buildInput())).rejects.toThrow(
        'Verify your Aadhaar number before submitting'
      );
      expect(kyc.submit).not.toHaveBeenCalled();
    });

    it('rejects with a PAN-specific message when PAN is not verified but mobile/Aadhaar are', async () => {
      kyc.findByUserId.mockResolvedValue(
        buildRecord({ mobileVerified: true, aadhaarVerified: true, panVerified: false })
      );

      await expect(service.submit('u1', buildInput())).rejects.toThrow(
        'Verify your PAN before submitting'
      );
      expect(kyc.submit).not.toHaveBeenCalled();
    });

    it('treats no existing record the same as an unverified one (mobile message first)', async () => {
      kyc.findByUserId.mockResolvedValue(null);

      await expect(service.submit('u1', buildInput())).rejects.toThrow(
        'Verify your mobile number before submitting'
      );
      expect(kyc.submit).not.toHaveBeenCalled();
    });
  });

  describe('listForReview', () => {
    it('passes the status filter through to the repository', async () => {
      const records = [buildAdminRecord()];
      kyc.findAllForReview.mockResolvedValue(records);

      await expect(service.listForReview('pending')).resolves.toEqual(records);
      expect(kyc.findAllForReview).toHaveBeenCalledWith('pending');
    });

    it('lists every reviewable status when no filter is given', async () => {
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
