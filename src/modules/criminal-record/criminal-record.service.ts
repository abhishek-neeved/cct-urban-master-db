import type { ICriminalRecordRepository } from './criminal-record.repository';
import { CriminalRecordCheck, PENDING_CRIMINAL_RECORD_CHECK } from './criminal-record.types';
import type { CriminalRecordStatus } from './criminal-record.model';

/**
 * Criminal-record status reads + admin-set results. Business logic only —
 * no HTTP, no mongoose. There is no user-facing submission: the check itself
 * happens outside this app (a real vendor integration, deferred) and an
 * admin records the outcome.
 */
export class CriminalRecordService {
  constructor(private readonly criminalRecord: ICriminalRecordRepository) {}

  async getStatus(userId: string): Promise<CriminalRecordCheck> {
    const record = await this.criminalRecord.findByUserId(userId);
    return record ?? PENDING_CRIMINAL_RECORD_CHECK;
  }

  async setStatus(
    userId: string,
    status: CriminalRecordStatus,
    reviewerId: string
  ): Promise<CriminalRecordCheck> {
    return this.criminalRecord.setStatus(userId, { status, checkedBy: reviewerId });
  }
}
