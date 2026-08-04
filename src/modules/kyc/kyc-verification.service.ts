import { env, isProduction } from '@config/env';
import { OTP_MAX_ATTEMPTS } from '@config/constants';
import type { IKycVerificationOtpRepository } from './kyc-verification-otp.repository';
import type { IKycVerifiedDocumentRepository } from './kyc-verified-document.repository';
import type { IKycVerificationProvider } from '@shared/services/kyc-verification.service';
import type { VerificationDocType } from './kyc.model';
import { generateNumericOtp, hashToken } from '@utils/token.util';
import { BadRequestError } from '@utils/errors';
import { logger } from '@utils/logger';

const MINUTE_MS = 60 * 1000;

export interface RequestVerificationResult {
  maskedMobileNumber: string;
  /** Raw OTP, returned only in non-production so the flow can be tested locally. */
  devOtp?: string;
}

/**
 * Aadhaar/PAN verification via OTP — one round-trip per doc type, mirroring
 * `AuthService`'s register/reset OTP flows exactly (hash the code, cap wrong
 * attempts, burn the code after too many failures). The provider
 * (`IKycVerificationProvider`) only ever mints/sends the code; this service
 * owns the actual comparison against what it stored, and persists success
 * to `IKycVerifiedDocumentRepository` so `KycService.submit()` can check it
 * later without re-verifying.
 */
export class KycVerificationService {
  constructor(
    private readonly provider: IKycVerificationProvider,
    private readonly otps: IKycVerificationOtpRepository,
    private readonly verifiedDocuments: IKycVerifiedDocumentRepository
  ) {}

  async requestAadharVerification(
    userId: string,
    aadharNumber: string
  ): Promise<RequestVerificationResult> {
    const { maskedMobileNumber } = await this.provider.requestAadharVerification(aadharNumber);
    const devOtp = await this.issueOtp(userId, 'aadhar', aadharNumber);
    logger.info('Aadhaar verification OTP requested', { userId });
    return { maskedMobileNumber, devOtp };
  }

  async verifyAadharOtp(userId: string, otp: string): Promise<void> {
    await this.verifyOtp(userId, 'aadhar', otp);
    logger.info('Aadhaar verified', { userId });
  }

  async requestPanVerification(
    userId: string,
    panNumber: string
  ): Promise<RequestVerificationResult> {
    const { maskedMobileNumber } = await this.provider.requestPanVerification(panNumber);
    const devOtp = await this.issueOtp(userId, 'pan', panNumber);
    logger.info('PAN verification OTP requested', { userId });
    return { maskedMobileNumber, devOtp };
  }

  async verifyPanOtp(userId: string, otp: string): Promise<void> {
    await this.verifyOtp(userId, 'pan', otp);
    logger.info('PAN verified', { userId });
  }

  async isAadharVerified(userId: string, aadharNumber: string): Promise<boolean> {
    return this.verifiedDocuments.isVerified(userId, 'aadhar', aadharNumber);
  }

  async isPanVerified(userId: string, panNumber: string): Promise<boolean> {
    return this.verifiedDocuments.isVerified(userId, 'pan', panNumber);
  }

  private async issueOtp(
    userId: string,
    docType: VerificationDocType,
    docValue: string
  ): Promise<string | undefined> {
    const rawOtp = generateNumericOtp();
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * MINUTE_MS);
    await this.otps.replaceForUser(userId, docType, docValue, hashToken(rawOtp), expiresAt);
    return isProduction ? undefined : rawOtp;
  }

  private async verifyOtp(
    userId: string,
    docType: VerificationDocType,
    code: string
  ): Promise<void> {
    const invalid = new BadRequestError('Invalid or expired verification code');

    const otp = await this.otps.findActiveForUser(userId, docType);
    if (!otp) {
      throw invalid;
    }
    if (otp.codeHash !== hashToken(code)) {
      const attempts = await this.otps.recordFailedAttempt(otp.id);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.otps.deleteForUser(userId, docType);
      }
      throw invalid;
    }

    await this.verifiedDocuments.markVerified(userId, docType, otp.docValue);
    await this.otps.deleteForUser(userId, docType);
  }
}
