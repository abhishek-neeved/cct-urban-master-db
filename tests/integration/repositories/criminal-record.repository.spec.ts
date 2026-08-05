import { Types } from 'mongoose';
import { CriminalRecordRepository } from '@modules/criminal-record/criminal-record.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('CriminalRecordRepository (integration)', () => {
  let repository: CriminalRecordRepository;
  const userId = new Types.ObjectId().toString();
  const adminId = new Types.ObjectId().toString();

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new CriminalRecordRepository();
  });

  it('returns null when no record exists for the user', async () => {
    await expect(repository.findByUserId(userId)).resolves.toBeNull();
  });

  it('creates a record on first setStatus (upsert)', async () => {
    const result = await repository.setStatus(userId, { status: 'clear', checkedBy: adminId });

    expect(result.status).toBe('clear');
    expect(result.checkedAt).toBeInstanceOf(Date);
    await expect(repository.findByUserId(userId)).resolves.toEqual(result);
  });

  it('overwrites an existing record on a subsequent setStatus', async () => {
    await repository.setStatus(userId, { status: 'pending', checkedBy: adminId });

    const updated = await repository.setStatus(userId, { status: 'flagged', checkedBy: adminId });

    expect(updated.status).toBe('flagged');
    await expect(repository.findByUserId(userId)).resolves.toEqual(updated);
  });
});
