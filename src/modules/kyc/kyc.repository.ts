import { KycModel, type KycRow, type KycStatus } from './kyc.model';
import { BaseRepository } from '@shared/repositories/base.repository';
import {
  AdminKycRecord,
  KycRecord,
  SubmitKycInput,
  toAdminKycRecord,
  toKycRecord,
} from './kyc.types';

export interface IKycRepository {
  findByUserId(userId: string): Promise<KycRecord | null>;
  findRowByUserId(userId: string): Promise<KycRow | null>;
  /** Upsert just the mobile number + its verified flag — creates the row on first call. */
  setMobileVerified(userId: string, mobileNumber: string): Promise<KycRecord>;
  /** Upsert just the Aadhaar number + its verified flag. */
  setAadhaarVerified(userId: string, aadharNumber: string): Promise<KycRecord>;
  /** Upsert just the PAN number + its verified flag. */
  setPanVerified(userId: string, panNumber: string): Promise<KycRecord>;
  /** Final submission — requires the row (and all three verified flags) to already exist; see `KycService.submit`. */
  submit(userId: string, input: SubmitKycInput): Promise<KycRecord>;
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

  async findRowByUserId(userId: string): Promise<KycRow | null> {
    return KycModel.findOne({ userId }).lean<KycRow>();
  }

  async setMobileVerified(userId: string, mobileNumber: string): Promise<KycRecord> {
    const row = await KycModel.findOneAndUpdate(
      { userId },
      {
        $set: { mobileNumber, mobileVerified: true },
        $setOnInsert: { status: 'not_started' },
      },
      { new: true, upsert: true }
    ).lean<KycRow>();
    return toKycRecord(row);
  }

  async setAadhaarVerified(userId: string, aadharNumber: string): Promise<KycRecord> {
    const row = await KycModel.findOneAndUpdate(
      { userId },
      { $set: { aadharNumber, aadhaarVerified: true } },
      { new: true }
    ).lean<KycRow>();
    return toKycRecord(row as KycRow);
  }

  async setPanVerified(userId: string, panNumber: string): Promise<KycRecord> {
    const row = await KycModel.findOneAndUpdate(
      { userId },
      { $set: { panNumber, panVerified: true } },
      { new: true }
    ).lean<KycRow>();
    return toKycRecord(row as KycRow);
  }

  async submit(userId: string, input: SubmitKycInput): Promise<KycRecord> {
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
      { new: true }
    ).lean<KycRow>();
    return toKycRecord(row as KycRow);
  }

  async findAllForReview(status?: KycStatus): Promise<AdminKycRecord[]> {
    const query = status ? { status } : { status: { $ne: 'not_started' } };
    const rows = await KycModel.find(query).lean<KycRow[]>();
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
      {
        status: 'rejected',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
      { new: true }
    ).lean<KycRow>();
    return row ? toAdminKycRecord(row) : null;
  }
}
