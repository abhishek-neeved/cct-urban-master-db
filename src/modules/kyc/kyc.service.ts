import type { IKycRepository } from './kyc.repository';
import { AdminKycRecord, KycRecord, NOT_STARTED_KYC_RECORD, SubmitKycInput } from './kyc.types';
import type { KycStatus } from './kyc.model';
import type { KycVerificationService } from './kyc-verification.service';
import { BadRequestError, NotFoundError } from '@utils/errors';
import { logger } from '@utils/logger';

/**
 * KYC submission + admin review. Business logic only — no HTTP, no mongoose.
 * The state machine has exactly one loop-back edge: pending -> verified,
 * pending -> rejected, rejected -> pending (resubmission). Verified is terminal
 * — there's no un-verify today.
 */
export class KycService {
  constructor(
    private readonly kyc: IKycRepository,
    private readonly verification: KycVerificationService
  ) {}

  async getStatus(userId: string): Promise<KycRecord> {
    const record = await this.kyc.findByUserId(userId);
    return record ?? NOT_STARTED_KYC_RECORD;
  }

  async submit(userId: string, input: SubmitKycInput): Promise<KycRecord> {
    const existing = await this.kyc.findByUserId(userId);
    if (existing?.status === 'verified') {
      throw new BadRequestError('Your identity is already verified — no resubmission is needed');
    }
    if (existing?.status === 'pending') {
      throw new BadRequestError('Your submission is already pending review');
    }

    const [aadharVerified, panVerified] = await Promise.all([
      this.verification.isAadharVerified(userId, input.aadharNumber),
      this.verification.isPanVerified(userId, input.panNumber),
    ]);
    if (!aadharVerified) {
      throw new BadRequestError('Verify your Aadhaar number before submitting');
    }
    if (!panVerified) {
      throw new BadRequestError('Verify your PAN before submitting');
    }

    const updated = await this.kyc.upsertSubmission(userId, input);
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
}
