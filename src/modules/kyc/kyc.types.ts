import type { KycRow, KycStatus } from './kyc.model';

/**
 * Domain representation returned to callers. Field names mirror mobile-app's
 * `KycRecord` mock shape exactly (`aadharImageKey`/`panImageKey`/
 * `photographKey` in place of the mock's local-URI fields, since these now
 * hold S3 object keys from `@modules/uploads` instead of on-device URIs) —
 * that parity is what makes Phase 3 integration a data-source swap rather
 * than a UI rewrite.
 */
export interface KycRecord {
  status: KycStatus;
  aadharNumber?: string;
  aadharImageKey?: string;
  panNumber?: string;
  panImageKey?: string;
  dateOfBirth?: Date;
  address?: string;
  photographKey?: string;
  uan?: string;
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
  aadharImageKey: string;
  panNumber: string;
  panImageKey: string;
  dateOfBirth?: Date;
  address: string;
  photographKey: string;
  uan?: string;
}

/** The "not started" state has no document — this is the domain default `getStatus` returns. */
export const NOT_STARTED_KYC_RECORD: KycRecord = { status: 'not_started' };

export const toKycRecord = (row: KycRow): KycRecord => ({
  status: row.status,
  aadharNumber: row.aadharNumber,
  aadharImageKey: row.aadharImageKey,
  panNumber: row.panNumber,
  panImageKey: row.panImageKey,
  dateOfBirth: row.dateOfBirth ?? undefined,
  address: row.address,
  photographKey: row.photographKey,
  uan: row.uan ?? undefined,
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
