import { CriminalRecordModel, type CriminalRecordRow, type CriminalRecordStatus } from './criminal-record.model';
import { CriminalRecordCheck, toCriminalRecordCheck } from './criminal-record.types';

export interface ISetCriminalRecordStatusInput {
  status: CriminalRecordStatus;
  checkedBy: string;
}

export interface ICriminalRecordRepository {
  findByUserId(userId: string): Promise<CriminalRecordCheck | null>;
  setStatus(userId: string, input: ISetCriminalRecordStatusInput): Promise<CriminalRecordCheck>;
}

/**
 * MongoDB-backed criminal-record store. Doesn't extend `BaseRepository` —
 * every operation here is keyed by `userId` (the collection's unique index),
 * and `setStatus` is an upsert (no document may exist yet), neither of which
 * fits the generic id-keyed CRUD surface. Mirrors `RefreshTokenRepository`'s
 * precedent for a repository that queries its collection directly instead.
 */
export class CriminalRecordRepository implements ICriminalRecordRepository {
  async findByUserId(userId: string): Promise<CriminalRecordCheck | null> {
    const row = await CriminalRecordModel.findOne({ userId }).lean<CriminalRecordRow>();
    return row ? toCriminalRecordCheck(row) : null;
  }

  async setStatus(
    userId: string,
    { status, checkedBy }: ISetCriminalRecordStatusInput
  ): Promise<CriminalRecordCheck> {
    const row = await CriminalRecordModel.findOneAndUpdate(
      { userId },
      { status, checkedBy, checkedAt: new Date() },
      { new: true, upsert: true }
    ).lean<CriminalRecordRow>();
    return toCriminalRecordCheck(row);
  }
}
