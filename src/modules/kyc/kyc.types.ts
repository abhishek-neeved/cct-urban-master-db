import type { KycRow, KycStatus } from './kyc.model';

/**
 * Domain representation returned to callers. No document uploads — identity
 * is proven by verifying Aadhaar/PAN via OTP (see `kyc-verification.service.ts`)
 * before `submit()` will accept a submission.
 */
export interface KycRecord {
  status: KycStatus;
  aadharNumber?: string;
  panNumber?: string;
  address?: string;
  submittedAt?: Date;
  rejectionReason?: string;
}

/** Returned to admins reviewing the queue — adds the fields a user's own view doesn't need. */
export interface AdminKycRecord extends KycRecord {
  id: string;
  userId: string;
  reviewedBy?: string;
  reviewedAt?: Date;
}

export interface SubmitKycInput {
  aadharNumber: string;
  panNumber: string;
  address: string;
}

/** The "not started" state has no document — this is the domain default `getStatus` returns. */
export const NOT_STARTED_KYC_RECORD: KycRecord = { status: 'not_started' };

export const toKycRecord = (row: KycRow): KycRecord => ({
  status: row.status,
  aadharNumber: row.aadharNumber,
  panNumber: row.panNumber,
  address: row.address,
  submittedAt: row.submittedAt,
  rejectionReason: row.rejectionReason ?? undefined,
});

export const toAdminKycRecord = (row: KycRow): AdminKycRecord => ({
  ...toKycRecord(row),
  id: String(row._id),
  userId: String(row.userId),
  reviewedBy: row.reviewedBy ? String(row.reviewedBy) : undefined,
  reviewedAt: row.reviewedAt ?? undefined,
});
