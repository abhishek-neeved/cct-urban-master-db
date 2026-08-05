import { Schema, model } from 'mongoose';
import { CreateUserInput } from '@modules/auth/user.types';
import { UserRepository } from '@modules/auth/user.repository';
import { BaseRepository } from '@shared/repositories/base.repository';
import { ConflictError } from '@utils/errors';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

// A minimal concrete repository that does NOT configure a duplicateKeyMessage,
// used to exercise BaseRepository's default conflict message.
interface WidgetRow {
  _id: unknown;
  sku: string;
}

const widgetSchema = new Schema<WidgetRow>({ sku: { type: String, required: true, unique: true } });
const WidgetModel = model<WidgetRow>('Widget', widgetSchema);

class WidgetRepository extends BaseRepository<
  WidgetRow,
  { id: string; sku: string },
  { sku: string }
> {
  constructor() {
    super(WidgetModel, (row) => ({ id: String(row._id), sku: row.sku }));
  }
}

// A well-formed ObjectId that was never inserted, for "missing" assertions.
const ABSENT_ID = '000000000000000000000000';

// BaseRepository is abstract; its generic CRUD is exercised here through the
// concrete UserRepository against a real (in-memory) MongoDB.
describe('BaseRepository (integration, via UserRepository)', () => {
  let repository: UserRepository;

  beforeAll(async () => {
    await connectTestDb();
    // Not part of the auth module's schema — created directly for this spec.
    await WidgetModel.init();
  });
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new UserRepository();
  });

  const make = (email: string, firstName = 'User') =>
    repository.create({ firstName, lastName: 'Test', email, password: 'hashed-pw', role: 'customer' });

  describe('find', () => {
    it('returns every document when no filter is given', async () => {
      await make('a@example.com');
      await make('b@example.com');
      await expect(repository.find()).resolves.toHaveLength(2);
    });

    it('returns only documents matching the filter (empty when none match)', async () => {
      await make('a@example.com', 'Ada');
      const matches = await repository.find({ email: 'a@example.com' });
      expect(matches).toHaveLength(1);
      expect(matches[0].firstName).toBe('Ada');
      await expect(repository.find({ email: 'nobody@example.com' })).resolves.toEqual([]);
    });
  });

  describe('count', () => {
    it('counts all documents and filtered subsets', async () => {
      await make('a@example.com');
      await make('b@example.com');
      await expect(repository.count()).resolves.toBe(2);
      await expect(repository.count({ email: 'a@example.com' })).resolves.toBe(1);
    });
  });

  describe('existsBy', () => {
    it('is true when a match exists and false otherwise', async () => {
      await make('a@example.com');
      await expect(repository.existsBy({ email: 'a@example.com' })).resolves.toBe(true);
      await expect(repository.existsBy({ email: 'nobody@example.com' })).resolves.toBe(false);
    });
  });

  describe('updateById', () => {
    it('updates and returns the new domain object', async () => {
      const user = await make('a@example.com', 'Old Name');
      const updated = await repository.updateById(user.id, { firstName: 'New Name' });
      expect(updated?.firstName).toBe('New Name');
    });

    it('returns null for a non-ObjectId id', async () => {
      await expect(repository.updateById('not-an-id', { firstName: 'x' })).resolves.toBeNull();
    });

    it('returns null when the id is well-formed but absent', async () => {
      await expect(repository.updateById(ABSENT_ID, { firstName: 'x' })).resolves.toBeNull();
    });
  });

  describe('deleteById', () => {
    it('returns true when a document is removed', async () => {
      const user = await make('a@example.com');
      await expect(repository.deleteById(user.id)).resolves.toBe(true);
      await expect(repository.findById(user.id)).resolves.toBeNull();
    });

    it('returns false for a non-ObjectId id', async () => {
      await expect(repository.deleteById('not-an-id')).resolves.toBe(false);
    });

    it('returns false when the id is well-formed but absent', async () => {
      await expect(repository.deleteById(ABSENT_ID)).resolves.toBe(false);
    });
  });

  describe('findOne', () => {
    it('returns null when nothing matches', async () => {
      await expect(repository.findOne({ email: 'ghost@example.com' })).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('maps a unique-constraint violation to a ConflictError with the configured message', async () => {
      await make('dup@example.com');
      await expect(make('dup@example.com')).rejects.toBeInstanceOf(ConflictError);
      await expect(make('dup@example.com')).rejects.toThrow(
        'A user with this email already exists'
      );
    });

    it('rethrows non-duplicate persistence errors untouched', async () => {
      // Missing the required `firstName` field triggers a Mongoose validation
      // error, which is NOT a duplicate-key error and must propagate as-is.
      const invalid = {
        lastName: 'Test',
        email: 'incomplete@example.com',
        password: 'pw',
      } as unknown as CreateUserInput;
      await expect(repository.create(invalid)).rejects.not.toBeInstanceOf(ConflictError);
    });

    it('falls back to the generic conflict message when none is configured', async () => {
      const widgets = new WidgetRepository();
      await widgets.create({ sku: 'SKU-1' });
      await expect(widgets.create({ sku: 'SKU-1' })).rejects.toThrow(
        'A record with these unique values already exists'
      );
    });
  });
});
