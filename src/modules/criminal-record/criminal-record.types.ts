import type { CriminalRecordRow, CriminalRecordStatus } from './criminal-record.model';

/**
 * Domain representation returned to callers. Field names mirror mobile-app's
 * `CriminalRecordCheck` mock shape exactly (`status`, `checkedAt`).
 */
export interface CriminalRecordCheck {
  status: CriminalRecordStatus;
  checkedAt?: Date;
}

/** No document exists until an admin sets one — this is the domain default `getStatus` returns until then. */
export const PENDING_CRIMINAL_RECORD_CHECK: CriminalRecordCheck = { status: 'pending' };

export const toCriminalRecordCheck = (row: CriminalRecordRow): CriminalRecordCheck => ({
  status: row.status,
  checkedAt: row.checkedAt ?? undefined,
});
