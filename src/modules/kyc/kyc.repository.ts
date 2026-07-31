import { KycModel, type KycRow } from './kyc.model';
import { BaseRepository } from '@shared/repositories/base.repository';
import {
  AdminKycRecord,
  KycRecord,
  SubmitKycInput,
  toAdminKycRecord,
  toKycRecord,
} from './kyc.types';
import type { KycStatus } from './kyc.model';

export interface IKycRepository {
  findByUserId(userId: string): Promise<KycRecord | null>;
  /** Create the user's first submission, or overwrite an existing one on resubmission. */
  upsertSubmission(userId: string, input: SubmitKycInput): Promise<KycRecord>;
  findAllForReview(status?: KycStatus): Promise<AdminKycRecord[]>;
  approve(userId: string, reviewerId: string): Promise<AdminKycRecord | null>;
  reject(userId: string, reviewerId: string, reason: string): Promise<AdminKycRecord | null>;
}

/**
 * MongoDB-backed KYC store. Inherits generic CRUD from `BaseRepository` but
 * every domain-specific query here is keyed by `userId` (the collection's
 * unique index), not by the document's own `_id` — there is exactly one KYC
 * document per user, so `userId` is the natural key callers actually have.
 */
export class KycRepository
  extends BaseRepository<KycRow, KycRecord, SubmitKycInput>
  implements IKycRepository
{
  constructor() {
    super(KycModel, toKycRecord, {
      duplicateKeyMessage: 'A KYC submission already exists for this user',
    });
  }

  async findByUserId(userId: string): Promise<KycRecord | null> {
    return this.findOne({ userId });
  }

  async upsertSubmission(userId: string, input: SubmitKycInput): Promise<KycRecord> {
    const row = await KycModel.findOneAndUpdate(
      { userId },
      {
        ...input,
        status: 'pending',
        submittedAt: new Date(),
        // A resubmission re-enters the review queue clean — any previous
        // rejection/approval trail is cleared rather than left stale.
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
      },
      { new: true, upsert: true }
    ).lean<KycRow>();
    return toKycRecord(row);
  }

  async findAllForReview(status?: KycStatus): Promise<AdminKycRecord[]> {
    const rows = await KycModel.find(status ? { status } : {}).lean<KycRow[]>();
    return rows.map(toAdminKycRecord);
  }

  async approve(userId: string, reviewerId: string): Promise<AdminKycRecord | null> {
    const row = await KycModel.findOneAndUpdate(
      { userId },
      { status: 'verified', reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: null },
      { new: true }
    ).lean<KycRow>();
    return row ? toAdminKycRecord(row) : null;
  }

  async reject(userId: string, reviewerId: string, reason: string): Promise<AdminKycRecord | null> {
    const row = await KycModel.findOneAndUpdate(
      { userId },
      { status: 'rejected', reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: reason },
      { new: true }
    ).lean<KycRow>();
    return row ? toAdminKycRecord(row) : null;
  }
}
