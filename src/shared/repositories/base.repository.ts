import { HydratedDocument, Model, QueryFilter, Types, UpdateQuery } from 'mongoose';
import { ConflictError } from '@utils/errors';

/** Mongo signals a unique-index violation with error code 11000. */
const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

export interface BaseRepositoryOptions {
  /** Message for the `ConflictError` thrown when a unique index is violated. */
  duplicateKeyMessage?: string;
}

/**
 * Generic Mongoose-backed repository. A concrete repository extends this with a
 * model and a document→domain mapper, inherits the common CRUD operations, and
 * adds its own domain-specific queries on top. All Mongo details (documents,
 * `_id`, ObjectId validation, duplicate-key errors) are contained here and never
 * leak past the repository layer.
 *
 * Type parameters:
 * - `TAttrs`  — the Mongoose schema attributes interface (e.g. `UserAttrs`)
 * - `TDomain` — the domain type returned to callers (e.g. `User`)
 * - `TCreate` — the shape accepted by `create()` (defaults to `TAttrs`)
 */
export abstract class BaseRepository<TAttrs, TDomain, TCreate = TAttrs> {
  protected constructor(
    protected readonly model: Model<TAttrs>,
    protected readonly toDomain: (doc: HydratedDocument<TAttrs>) => TDomain,
    private readonly options: BaseRepositoryOptions = {}
  ) {}

  /** Find one document by id. Returns `null` for a missing or non-ObjectId id. */
  async findById(id: string): Promise<TDomain | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? this.toDomain(doc) : null;
  }

  /** Find the first document matching `filter`, or `null`. */
  async findOne(filter: QueryFilter<TAttrs>): Promise<TDomain | null> {
    const doc = await this.model.findOne(filter).exec();
    return doc ? this.toDomain(doc) : null;
  }

  /** Find all documents matching `filter` (defaults to every document). */
  async find(filter: QueryFilter<TAttrs> = {}): Promise<TDomain[]> {
    const docs = await this.model.find(filter).exec();
    return docs.map((doc) => this.toDomain(doc));
  }

  /** Persist a new document, mapping a unique-index violation to a `ConflictError`. */
  async create(input: TCreate): Promise<TDomain> {
    try {
      // Mongoose 9 tightened `create()`'s parameter typing; the generic
      // `TCreate` is structurally compatible but not provably so, so cast to the
      // model's partial-attrs shape.
      const doc = await this.model.create(input as Partial<TAttrs>);
      return this.toDomain(doc);
    } catch (err) {
      // A concurrent insert can slip past a service-level pre-check; the unique
      // index is the real guard. Map its error to a clean 409 (Mongo specifics
      // never leak past the repository).
      if (isDuplicateKeyError(err)) {
        throw new ConflictError(
          this.options.duplicateKeyMessage ?? 'A record with these unique values already exists'
        );
      }
      throw err;
    }
  }

  /** Update a document by id and return the updated domain object (or `null`). */
  async updateById(id: string, update: UpdateQuery<TAttrs>): Promise<TDomain | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.model.findByIdAndUpdate(id, update, { returnDocument: 'after' }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  /** Delete a document by id. Returns `true` if a document was removed. */
  async deleteById(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const doc = await this.model.findByIdAndDelete(id).exec();
    return doc !== null;
  }

  /** Count documents matching `filter` (defaults to every document). */
  async count(filter: QueryFilter<TAttrs> = {}): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  /** Whether any document matches `filter`. */
  async existsBy(filter: QueryFilter<TAttrs>): Promise<boolean> {
    const doc = await this.model.exists(filter).exec();
    return doc !== null;
  }
}
