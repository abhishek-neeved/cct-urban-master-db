import { isValidObjectId, type FilterQuery, type Model, type UpdateQuery } from 'mongoose';
import { ConflictError } from '@utils/errors';

/** MongoDB signals a unique-index violation with error code 11000 (numeric, unlike Postgres's SQLSTATE string). */
const MONGO_DUPLICATE_KEY = 11000;

const isDuplicateKeyError = (err: unknown): boolean =>
  (err as { code?: unknown } | undefined)?.code === MONGO_DUPLICATE_KEY;

export interface BaseRepositoryOptions {
  /** Message for the `ConflictError` thrown when a unique index is violated. */
  duplicateKeyMessage?: string;
}

/**
 * Generic Mongoose-backed repository over a collection with an `ObjectId`
 * primary key. A concrete repository extends this with a `Model` (defined in
 * its module's `*.model.ts`), a document→domain mapper, and adds its own
 * domain-specific queries on top. All MongoDB details (raw documents, id
 * validation, duplicate-key errors) are contained here and never leak past
 * the repository layer.
 *
 * Type parameters:
 * - `TRow`    — the Mongoose document shape (e.g. `UserRow`)
 * - `TDomain` — the domain type returned to callers (e.g. `User`)
 * - `TCreate` — the shape accepted by `create()` (defaults to `TRow`)
 */
export abstract class BaseRepository<TRow, TDomain, TCreate = TRow> {
  protected constructor(
    protected readonly model: Model<TRow>,
    protected readonly toDomain: (row: TRow) => TDomain,
    private readonly options: BaseRepositoryOptions = {}
  ) {}

  /** Find one document by id. Returns `null` for a missing or non-ObjectId id. */
  async findById(id: string): Promise<TDomain | null> {
    if (!isValidObjectId(id)) return null;
    const row = await this.model.findById(id).lean<TRow>();
    return row ? this.toDomain(row) : null;
  }

  /** Find the first document matching `where`, or `null`. */
  async findOne(where: FilterQuery<TRow>): Promise<TDomain | null> {
    const row = await this.model.findOne(where).lean<TRow>();
    return row ? this.toDomain(row) : null;
  }

  /** Find all documents matching `where` (defaults to every document). */
  async find(where: FilterQuery<TRow> = {}): Promise<TDomain[]> {
    const rows = await this.model.find(where).lean<TRow[]>();
    return rows.map((row) => this.toDomain(row));
  }

  /** Persist a new document, mapping a unique-index violation to a `ConflictError`. */
  async create(input: TCreate): Promise<TDomain> {
    try {
      const doc = await this.model.create(input as unknown as TRow);
      return this.toDomain(doc.toObject() as TRow);
    } catch (err) {
      // A concurrent insert can slip past a service-level pre-check; the
      // unique index is the real guard. Map its error to a clean 409 (Mongo
      // specifics never leak past the repository).
      if (isDuplicateKeyError(err)) {
        throw new ConflictError(
          this.options.duplicateKeyMessage ?? 'A record with these unique values already exists'
        );
      }
      throw err;
    }
  }

  /** Update a document by id and return the updated domain object (or `null`). */
  async updateById(id: string, update: UpdateQuery<TRow>): Promise<TDomain | null> {
    if (!isValidObjectId(id)) return null;
    const row = await this.model.findByIdAndUpdate(id, update, { new: true }).lean<TRow>();
    return row ? this.toDomain(row) : null;
  }

  /** Delete a document by id. Returns `true` if a document was removed. */
  async deleteById(id: string): Promise<boolean> {
    if (!isValidObjectId(id)) return false;
    const row = await this.model.findByIdAndDelete(id).lean<TRow>();
    return row !== null;
  }

  /** Count documents matching `where` (defaults to every document). */
  async count(where: FilterQuery<TRow> = {}): Promise<number> {
    return this.model.countDocuments(where);
  }

  /** Whether any document matches `where`. */
  async existsBy(where: FilterQuery<TRow>): Promise<boolean> {
    return (await this.model.exists(where)) !== null;
  }
}
