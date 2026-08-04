import { Types } from 'mongoose';
import { ServiceProfileRepository } from '@modules/service-profile/service-profile.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('ServiceProfileRepository (integration)', () => {
  let repository: ServiceProfileRepository;
  const userId = new Types.ObjectId().toString();

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new ServiceProfileRepository();
  });

  it('returns null when no profile exists for the user', async () => {
    await expect(repository.findByUserId(userId)).resolves.toBeNull();
  });

  it('creates a first profile with defaults for omitted optional fields', async () => {
    const profile = await repository.upsert(userId, { category: 'plumber' });

    expect(profile).toEqual({ category: 'plumber', description: null, yearsOfExperience: null });
    await expect(repository.findByUserId(userId)).resolves.toEqual(profile);
  });

  it('creates a first profile with description and years of experience', async () => {
    const profile = await repository.upsert(userId, {
      category: 'electrician',
      description: 'Residential wiring',
      yearsOfExperience: 5,
    });

    expect(profile).toEqual({
      category: 'electrician',
      description: 'Residential wiring',
      yearsOfExperience: 5,
    });
  });

  it('overwrites an existing profile on a second upsert', async () => {
    await repository.upsert(userId, { category: 'plumber', description: 'Pipes' });

    const updated = await repository.upsert(userId, {
      category: 'carpenter',
      yearsOfExperience: 3,
    });

    expect(updated).toEqual({ category: 'carpenter', description: null, yearsOfExperience: 3 });
    await expect(repository.findByUserId(userId)).resolves.toEqual(updated);
  });
});
