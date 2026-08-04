import { vi, type Mocked } from 'vitest';
import type {
  IKycVerificationOtpRepository,
  KycVerificationOtpRecord,
} from '@modules/kyc/kyc-verification-otp.repository';
import type { IKycVerifiedDocumentRepository } from '@modules/kyc/kyc-verified-document.repository';
import type { IKycVerificationProvider } from '@shared/services/kyc-verification.service';
import { hashToken } from '@utils/token.util';
import { BadRequestError } from '@utils/errors';
import { OTP_MAX_ATTEMPTS } from '@config/constants';

// Mutable production flag, mirroring kyc-verification-provider.service.spec.ts
// — `issueOtp`'s isProduction ? undefined : rawOtp branch needs both sides
// exercised explicitly, not just the default (false) from the real env.
const state = vi.hoisted(() => ({ isProduction: false }));
vi.mock('@config/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@config/env')>()),
  get isProduction() {
    return state.isProduction;
  },
}));

const { KycVerificationService } = await import('@modules/kyc/kyc-verification.service');

const buildOtp = (
  code: string,
  overrides: Partial<KycVerificationOtpRecord> = {}
): KycVerificationOtpRecord => ({
  id: '507f1f77bcf86cd799439099',
  docValue: '123456789012',
  codeHash: hashToken(code),
  attempts: 0,
  createdAt: new Date('2020-01-01'),
  ...overrides,
});

describe('KycVerificationService', () => {
  let provider: Mocked<IKycVerificationProvider>;
  let otps: Mocked<IKycVerificationOtpRepository>;
  let verifiedDocuments: Mocked<IKycVerifiedDocumentRepository>;
  let service: KycVerificationService;

  beforeEach(() => {
    state.isProduction = false;
    provider = {
      requestAadharVerification: vi.fn().mockResolvedValue({ maskedMobileNumber: '9XXXXX9012' }),
      requestPanVerification: vi.fn().mockResolvedValue({ maskedMobileNumber: '9XXXXX234F' }),
    };
    otps = {
      findActiveForUser: vi.fn(),
      replaceForUser: vi.fn(),
      recordFailedAttempt: vi.fn(),
      deleteForUser: vi.fn(),
    };
    verifiedDocuments = {
      isVerified: vi.fn(),
      markVerified: vi.fn(),
    };
    service = new KycVerificationService(provider, otps, verifiedDocuments);
  });

  describe('requestAadharVerification', () => {
    it('requests from the provider and issues/stores a hashed OTP for the aadhar doc type', async () => {
      const result = await service.requestAadharVerification('u1', '123456789012');

      expect(provider.requestAadharVerification).toHaveBeenCalledWith('123456789012');
      expect(otps.replaceForUser).toHaveBeenCalledWith(
        'u1',
        'aadhar',
        '123456789012',
        expect.any(String),
        expect.any(Date)
      );
      expect(result.maskedMobileNumber).toBe('9XXXXX9012');
      expect(result.devOtp).toMatch(/^\d{6}$/);
      const [, , , storedHash] = otps.replaceForUser.mock.calls[0];
      expect(storedHash).toBe(hashToken(result.devOtp as string));
    });

    it('never returns the OTP in production, but still stores its hash', async () => {
      state.isProduction = true;

      const result = await service.requestAadharVerification('u1', '123456789012');

      expect(result.devOtp).toBeUndefined();
      expect(otps.replaceForUser).toHaveBeenCalledWith(
        'u1',
        'aadhar',
        '123456789012',
        expect.any(String),
        expect.any(Date)
      );
    });
  });

  describe('requestPanVerification', () => {
    it('requests from the provider and issues/stores a hashed OTP for the pan doc type', async () => {
      const result = await service.requestPanVerification('u1', 'ABCDE1234F');

      expect(provider.requestPanVerification).toHaveBeenCalledWith('ABCDE1234F');
      expect(otps.replaceForUser).toHaveBeenCalledWith(
        'u1',
        'pan',
        'ABCDE1234F',
        expect.any(String),
        expect.any(Date)
      );
      expect(result.maskedMobileNumber).toBe('9XXXXX234F');
      expect(result.devOtp).toMatch(/^\d{6}$/);
    });
  });

  describe('verifyAadharOtp', () => {
    it('marks the document verified and consumes the OTP on a correct code', async () => {
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));

      await service.verifyAadharOtp('u1', '123456');

      expect(otps.findActiveForUser).toHaveBeenCalledWith('u1', 'aadhar');
      expect(verifiedDocuments.markVerified).toHaveBeenCalledWith('u1', 'aadhar', '123456789012');
      expect(otps.deleteForUser).toHaveBeenCalledWith('u1', 'aadhar');
      expect(otps.recordFailedAttempt).not.toHaveBeenCalled();
    });

    it('throws BadRequestError when there is no active OTP', async () => {
      otps.findActiveForUser.mockResolvedValue(null);

      await expect(service.verifyAadharOtp('u1', '123456')).rejects.toThrow(BadRequestError);
      expect(verifiedDocuments.markVerified).not.toHaveBeenCalled();
    });

    it('records a failed attempt and throws on a wrong code, without deleting the OTP under the cap', async () => {
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));
      otps.recordFailedAttempt.mockResolvedValue(1);

      await expect(service.verifyAadharOtp('u1', '000000')).rejects.toThrow(BadRequestError);
      expect(otps.recordFailedAttempt).toHaveBeenCalledWith('507f1f77bcf86cd799439099');
      expect(otps.deleteForUser).not.toHaveBeenCalled();
      expect(verifiedDocuments.markVerified).not.toHaveBeenCalled();
    });

    it('deletes the OTP once the attempt cap is reached', async () => {
      otps.findActiveForUser.mockResolvedValue(buildOtp('123456'));
      otps.recordFailedAttempt.mockResolvedValue(OTP_MAX_ATTEMPTS);

      await expect(service.verifyAadharOtp('u1', '000000')).rejects.toThrow(BadRequestError);
      expect(otps.deleteForUser).toHaveBeenCalledWith('u1', 'aadhar');
    });
  });

  describe('verifyPanOtp', () => {
    it('marks the document verified and consumes the OTP on a correct code', async () => {
      otps.findActiveForUser.mockResolvedValue(buildOtp('654321', { docValue: 'ABCDE1234F' }));

      await service.verifyPanOtp('u1', '654321');

      expect(otps.findActiveForUser).toHaveBeenCalledWith('u1', 'pan');
      expect(verifiedDocuments.markVerified).toHaveBeenCalledWith('u1', 'pan', 'ABCDE1234F');
      expect(otps.deleteForUser).toHaveBeenCalledWith('u1', 'pan');
    });

    it('throws BadRequestError on a wrong code', async () => {
      otps.findActiveForUser.mockResolvedValue(buildOtp('654321', { docValue: 'ABCDE1234F' }));
      otps.recordFailedAttempt.mockResolvedValue(1);

      await expect(service.verifyPanOtp('u1', '000000')).rejects.toThrow(BadRequestError);
      expect(verifiedDocuments.markVerified).not.toHaveBeenCalled();
    });
  });

  describe('isAadharVerified / isPanVerified', () => {
    it('delegates to the verified-documents repository, scoped by doc type', async () => {
      verifiedDocuments.isVerified.mockResolvedValue(true);

      await expect(service.isAadharVerified('u1', '123456789012')).resolves.toBe(true);
      expect(verifiedDocuments.isVerified).toHaveBeenCalledWith('u1', 'aadhar', '123456789012');

      await service.isPanVerified('u1', 'ABCDE1234F');
      expect(verifiedDocuments.isVerified).toHaveBeenCalledWith('u1', 'pan', 'ABCDE1234F');
    });
  });
});
