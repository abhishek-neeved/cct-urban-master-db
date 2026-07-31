import { Types } from 'mongoose';
import { toCriminalRecordCheck } from '@modules/criminal-record/criminal-record.types';
import type { CriminalRecordRow } from '@modules/criminal-record/criminal-record.model';

const buildRow = (overrides: Partial<CriminalRecordRow> = {}): CriminalRecordRow =>
  ({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    status: 'pending',
    checkedAt: null,
    checkedBy: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    ...overrides,
  }) as CriminalRecordRow;

describe('toCriminalRecordCheck', () => {
  it('maps checkedAt to undefined when the row has never been checked', () => {
    const result = toCriminalRecordCheck(buildRow({ checkedAt: null }));

    expect(result).toEqual({ status: 'pending', checkedAt: undefined });
  });

  it('maps checkedAt through when the row has a real timestamp', () => {
    const checkedAt = new Date('2020-06-01');
    const result = toCriminalRecordCheck(buildRow({ status: 'clear', checkedAt }));

    expect(result).toEqual({ status: 'clear', checkedAt });
  });
});
