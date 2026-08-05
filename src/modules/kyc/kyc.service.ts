import type { IKycRepository } from './kyc.repository';
import type { IKycOtpRepository } from './kyc-otp.repository';
import { AdminKycRecord, KycRecord, NOT_STARTED_KYC_RECORD, SubmitKycInput } from './kyc.types';
import type { KycStatus } from './kyc.model';
import type {
  IMobileVerificationProvider,
  MobileToPanResult,
} from '@shared/services/mobile-verification.service';
import { env, isProduction } from '@config/env';
import { OTP_MAX_ATTEMPTS } from '@config/constants';
import { generateNumericOtp, hashToken } from '@utils/token.util';
import { BadRequestError, NotFoundError } from '@utils/errors';
import { logger } from '@utils/logger';

const MINUTE_MS = 60 * 1000;
/** Aadhaar can only ever be compared on its last 4 digits — the mobile-to-pan lookup never returns the full number. */
const AADHAAR_LAST_DIGITS = 4;

export interface RequestMobileVerificationResult {
  /** Raw OTP, returned only in non-production so the flow can be tested locally. */
  devOtp?: string;
}

/**
 * KYC verification + submission. Business logic only — no HTTP, no
 * mongoose.
 *
 * Verification order is enforced: mobile number first (proven by OTP, the
 * only OTP round-trip in this flow), then Aadhaar/PAN — each proven by
 * calling CoinCircleTrust's mobile-to-pan lookup for the *already-verified*
 * mobile number and comparing its result against what the user typed. No
 * full identity data is persisted — only the pass/fail outcome for each
 * field, on the same `Kyc` document the eventual submission uses.
 *
 * `submit()` requires all three `*Verified` flags and goes straight to
 * `verified` — every field was already checked against real third-party
 * data, so there is nothing left for a human reviewer to confirm. There is
 * no `pending` state in this flow; it only exists as a historical status
 * value the `listForReview`/`approve`/`reject` admin methods still support,
 * kept for a possible future manual-re-review path (e.g. flagging a
 * verified user back for a second look) rather than active use today.
 * Verified is terminal — there's no un-verify today.
 */
export class KycService {
  constructor(
    private readonly kyc: IKycRepository,
    private readonly otps: IKycOtpRepository,
    private readonly mobileVerificationProvider: IMobileVerificationProvider
  ) {}

  async getStatus(userId: string): Promise<KycRecord> {
    const record = await this.kyc.findByUserId(userId);
    return record ?? NOT_STARTED_KYC_RECORD;
  }

  async requestMobileVerification(
    userId: string,
    mobileNumber: string
  ): Promise<RequestMobileVerificationResult> {
    const rawOtp = generateNumericOtp();
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * MINUTE_MS);
    await this.otps.replaceForUser(userId, mobileNumber, hashToken(rawOtp), expiresAt);
    logger.info('Mobile verification OTP requested', { userId });
    return { devOtp: isProduction ? undefined : rawOtp };
  }

  async confirmMobileOtp(userId: string, code: string): Promise<KycRecord> {
    const invalid = new BadRequestError('Invalid or expired verification code');

    const otp = await this.otps.findActiveForUser(userId);
    if (!otp) {
      throw invalid;
    }
    if (otp.codeHash !== hashToken(code)) {
      const attempts = await this.otps.recordFailedAttempt(otp.id);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.otps.deleteForUser(userId);
      }
      throw invalid;
    }

    // Fetched exactly once here, not re-fetched by verifyAadhaar/verifyPan —
    // this is a real, billed API call, so caching it on the row (read back
    // in requireMobileLookup) is a direct cost optimization, not just a
    // performance one.
    const lookup = await this.mobileVerificationProvider.lookupByMobileNumber(otp.mobileNumber);
    const record = await this.kyc.setMobileVerified(userId, otp.mobileNumber, lookup);
    await this.otps.deleteForUser(userId);
    logger.info('Mobile number verified', { userId });
    return record;
  }

  /**
   * Verifies an Aadhaar number by comparing its last 4 digits against the
   * `masked_aadhaar` from the cached mobile-to-pan lookup — that field is
   * the only part of the real Aadhaar number the API ever discloses.
   */
  async verifyAadhaar(userId: string, aadharNumber: string): Promise<KycRecord> {
    const lookup = await this.requireMobileLookup(userId);

    const expectedLastDigits = lookup.masked_aadhaar.slice(-AADHAAR_LAST_DIGITS);
    const actualLastDigits = aadharNumber.slice(-AADHAAR_LAST_DIGITS);
    if (expectedLastDigits !== actualLastDigits) {
      throw new BadRequestError(
        'This Aadhaar number does not match the one linked to your mobile number'
      );
    }

    const record = await this.kyc.setAadhaarVerified(userId, aadharNumber);
    logger.info('Aadhaar verified', { userId });
    return record;
  }

  /**
   * Verifies a PAN by comparing it against the `pan_number` from the cached
   * mobile-to-pan lookup.
   */
  async verifyPan(userId: string, panNumber: string): Promise<KycRecord> {
    const lookup = await this.requireMobileLookup(userId);

    if (lookup.pan_number.toUpperCase() !== panNumber.toUpperCase()) {
      throw new BadRequestError('This PAN does not match the one linked to your mobile number');
    }

    const record = await this.kyc.setPanVerified(userId, panNumber);
    logger.info('PAN verified', { userId });
    return record;
  }

  async submit(userId: string, input: SubmitKycInput): Promise<KycRecord> {
    const existing = await this.kyc.findByUserId(userId);
    if (existing?.status === 'verified') {
      throw new BadRequestError('Your identity is already verified — no resubmission is needed');
    }
    if (!existing?.mobileVerified) {
      throw new BadRequestError('Verify your mobile number before submitting');
    }
    if (!existing.aadhaarVerified) {
      throw new BadRequestError('Verify your Aadhaar number before submitting');
    }
    if (!existing.panVerified) {
      throw new BadRequestError('Verify your PAN before submitting');
    }

    const updated = await this.kyc.submit(userId, input);
    logger.info('KYC submitted', { userId });
    return updated;
  }

  async listForReview(status?: KycStatus): Promise<AdminKycRecord[]> {
    return this.kyc.findAllForReview(status);
  }

  async approve(userId: string, reviewerId: string): Promise<AdminKycRecord> {
    const existing = await this.kyc.findByUserId(userId);
    if (!existing) {
      throw new NotFoundError('KYC submission');
    }
    if (existing.status !== 'pending') {
      throw new BadRequestError(`Cannot approve a submission with status "${existing.status}"`);
    }
    const updated = await this.kyc.approve(userId, reviewerId);
    logger.info('KYC approved', { userId, reviewerId });
    return updated as AdminKycRecord;
  }

  async reject(userId: string, reviewerId: string, reason: string): Promise<AdminKycRecord> {
    const existing = await this.kyc.findByUserId(userId);
    if (!existing) {
      throw new NotFoundError('KYC submission');
    }
    if (existing.status !== 'pending') {
      throw new BadRequestError(`Cannot reject a submission with status "${existing.status}"`);
    }
    const updated = await this.kyc.reject(userId, reviewerId, reason);
    logger.info('KYC rejected', { userId, reviewerId, reason });
    return updated as AdminKycRecord;
  }

  private async requireMobileLookup(userId: string): Promise<MobileToPanResult> {
    const row = await this.kyc.findRowByUserId(userId);
    if (!row?.mobileVerified || !row.mobileLookup) {
      throw new BadRequestError('Verify your mobile number before verifying Aadhaar or PAN');
    }
    return row.mobileLookup as unknown as MobileToPanResult;
  }
}
