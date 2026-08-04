import type { KycRow, KycStatus } from './kyc.model';

/**
 * Domain representation returned to callers. Mobile number is verified via
 * OTP; Aadhaar/PAN are each verified by comparing the user-entered number
 * against CoinCircleTrust's mobile-to-pan lookup for the verified mobile
 * number (see `kyc.service.ts`) — no full identity data is stored, only the
 * verification outcome for each field.
 */
export interface KycRecord {
  status: KycStatus;
  mobileNumber?: string;
  mobileVerified: boolean;
  aadharNumber?: string;
  aadhaarVerified: boolean;
  panNumber?: string;
  panVerified: boolean;
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
  address: string;
}

/** The "not started" state has no document — this is the domain default `getStatus` returns before the first Verify call creates the row. */
export const NOT_STARTED_KYC_RECORD: KycRecord = {
  status: 'not_started',
  mobileVerified: false,
  aadhaarVerified: false,
  panVerified: false,
};

export const toKycRecord = (row: KycRow): KycRecord => ({
  status: row.status,
  mobileNumber: row.mobileNumber ?? undefined,
  mobileVerified: row.mobileVerified,
  aadharNumber: row.aadharNumber ?? undefined,
  aadhaarVerified: row.aadhaarVerified,
  panNumber: row.panNumber ?? undefined,
  panVerified: row.panVerified,
  address: row.address ?? undefined,
  submittedAt: row.submittedAt ?? undefined,
  rejectionReason: row.rejectionReason ?? undefined,
});

export const toAdminKycRecord = (row: KycRow): AdminKycRecord => ({
  ...toKycRecord(row),
  id: String(row._id),
  userId: String(row.userId),
  reviewedBy: row.reviewedBy ? String(row.reviewedBy) : undefined,
  reviewedAt: row.reviewedAt ?? undefined,
});
