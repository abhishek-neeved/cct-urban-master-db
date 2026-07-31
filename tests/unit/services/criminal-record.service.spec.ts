import { vi, type Mocked } from 'vitest';
import { CriminalRecordService } from '@modules/criminal-record/criminal-record.service';
import type { ICriminalRecordRepository } from '@modules/criminal-record/criminal-record.repository';
import type { CriminalRecordCheck } from '@modules/criminal-record/criminal-record.types';

describe('CriminalRecordService', () => {
  let criminalRecord: Mocked<ICriminalRecordRepository>;
  let service: CriminalRecordService;

  beforeEach(() => {
    criminalRecord = { findByUserId: vi.fn(), setStatus: vi.fn() };
    service = new CriminalRecordService(criminalRecord);
  });

  describe('getStatus', () => {
    it('returns "pending" when no record exists', async () => {
      criminalRecord.findByUserId.mockResolvedValue(null);

      await expect(service.getStatus('u1')).resolves.toEqual({ status: 'pending' });
    });

    it('returns the stored record when one exists', async () => {
      const record: CriminalRecordCheck = { status: 'clear', checkedAt: new Date('2020-01-01') };
      criminalRecord.findByUserId.mockResolvedValue(record);

      await expect(service.getStatus('u1')).resolves.toEqual(record);
    });
  });

  describe('setStatus', () => {
    it('sets the status via the repository, recording the reviewer', async () => {
      const updated: CriminalRecordCheck = { status: 'flagged', checkedAt: new Date('2020-01-01') };
      criminalRecord.setStatus.mockResolvedValue(updated);

      const result = await service.setStatus('u1', 'flagged', 'admin1');

      expect(criminalRecord.setStatus).toHaveBeenCalledWith('u1', {
        status: 'flagged',
        checkedBy: 'admin1',
      });
      expect(result).toEqual(updated);
    });
  });
});
