import { count, eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { validate as isUuid } from 'uuid';
import { buildPaginatedResult, type PaginatedResult } from '@nvcct/db-entities';
import { ConflictError } from '@utils/errors';

/** Postgres signals a unique-constraint violation with SQLSTATE 23505 (a string, unlike Mongo's numeric 11000). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * drizzle-orm wraps driver errors in a `DrizzleQueryError`, whose own `.code`
 * is undefined — the Postgres SQLSTATE lives on `.cause.code` instead. Check
 * both so this works whether a future drizzle version stops wrapping or not.
 */
const isDuplicateKeyError = (err: unknown): boolean => {
  const direct = (err as { code?: unknown } | undefined)?.code;
  const cause = (err as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return direct === PG_UNIQUE_VIOLATION || cause === PG_UNIQUE_VIOLATION;
};

export interface BaseRepositoryOptions {
  /** Message for the `ConflictError` thrown when a unique index is violated. */
  duplicateKeyMessage?: string;
}

/**
 * Only the query-builder methods this class needs, decoupled from any
 * particular schema's type parameter. `PostgresJsDatabase<SchemaA>` and
 * `PostgresJsDatabase<SchemaB>` are otherwise structurally incompatible
 * (their `.query` relational-query property differs per schema), but
 * `select`/`insert`/`update`/`delete` are generic per call and identical
 * regardless of schema — so a `Pick` of just those is schema-agnostic and
 * accepts the app's real `db` instance (typed to the full `@nvcct/db-entities`
 * schema) without that mismatch.
 */
type QueryableDb = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

/**
 * Generic Drizzle-backed repository over a Postgres table with a `uuid`
 * primary key. A concrete repository extends this with a table (from
 * `@nvcct/db-entities`), a row→domain mapper, and adds its own domain-specific
 * queries on top. All Postgres details (rows, id validation, duplicate-key
 * errors) are contained here and never leak past the repository layer.
 *
 * Type parameters:
 * - `TTable`  — the Drizzle `pgTable(...)` definition (e.g. `usersTable`)
 * - `TRow`    — the table's inferred select type (e.g. `UserRow`)
 * - `TDomain` — the domain type returned to callers (e.g. `User`)
 * - `TCreate` — the shape accepted by `create()` (defaults to `TRow`)
 */
export abstract class BaseRepository<TTable extends PgTable, TRow, TDomain, TCreate = TRow> {
  protected constructor(
    protected readonly db: QueryableDb,
    protected readonly table: TTable,
    protected readonly idColumn: PgColumn,
    protected readonly toDomain: (row: TRow) => TDomain,
    private readonly options: BaseRepositoryOptions = {}
  ) {}

  /** Find one row by id. Returns `null` for a missing or non-uuid id. */
  async findById(id: string): Promise<TDomain | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db
      .select()
      .from(this.table as PgTable)
      .where(eq(this.idColumn, id))
      .limit(1);
    return row ? this.toDomain(row as TRow) : null;
  }

  /** Find the first row matching `where`, or `null`. */
  async findOne(where: SQL): Promise<TDomain | null> {
    const [row] = await this.db
      .select()
      .from(this.table as PgTable)
      .where(where)
      .limit(1);
    return row ? this.toDomain(row as TRow) : null;
  }

  /** Find all rows matching `where` (defaults to every row). */
  async find(where?: SQL): Promise<TDomain[]> {
    const query = this.db.select().from(this.table as PgTable);
    const rows = where ? await query.where(where) : await query;
    return rows.map((row) => this.toDomain(row as TRow));
  }

  /**
   * Find rows matching `where` one page at a time. Runs the page query and the
   * count query in parallel against the *same* `where`, so `total` reflects
   * the filtered set — not the whole table — unlike a naive count-then-slice.
   */
  async findPaginated(
    where: SQL | undefined,
    page: number,
    limit: number
  ): Promise<PaginatedResult<TDomain>> {
    const offset = (page - 1) * limit;
    const dataQuery = this.db.select().from(this.table as PgTable);
    const countQuery = this.db.select({ value: count() }).from(this.table as PgTable);

    const [rows, [countRow]] = await Promise.all([
      (where ? dataQuery.where(where) : dataQuery).limit(limit).offset(offset),
      where ? countQuery.where(where) : countQuery,
    ]);

    return buildPaginatedResult(
      rows.map((row) => this.toDomain(row as TRow)),
      Number(countRow.value),
      page,
      limit
    );
  }

  /** Persist a new row, mapping a unique-constraint violation to a `ConflictError`. */
  async create(input: TCreate): Promise<TDomain> {
    try {
      const [row] = await this.db
        .insert(this.table as PgTable)
        .values(input as never)
        .returning();
      return this.toDomain(row as TRow);
    } catch (err) {
      // A concurrent insert can slip past a service-level pre-check; the
      // unique constraint is the real guard. Map its error to a clean 409
      // (Postgres specifics never leak past the repository).
      if (isDuplicateKeyError(err)) {
        throw new ConflictError(
          this.options.duplicateKeyMessage ?? 'A record with these unique values already exists'
        );
      }
      throw err;
    }
  }

  /** Update a row by id and return the updated domain object (or `null`). */
  async updateById(id: string, update: Partial<TRow>): Promise<TDomain | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db
      .update(this.table as PgTable)
      .set(update as never)
      .where(eq(this.idColumn, id))
      .returning();
    return row ? this.toDomain(row as TRow) : null;
  }

  /** Delete a row by id. Returns `true` if a row was removed. */
  async deleteById(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const [row] = await this.db
      .delete(this.table as PgTable)
      .where(eq(this.idColumn, id))
      .returning();
    return row !== undefined;
  }

  /** Count rows matching `where` (defaults to every row). */
  async count(where?: SQL): Promise<number> {
    const query = this.db.select({ value: count() }).from(this.table as PgTable);
    const [row] = where ? await query.where(where) : await query;
    return Number(row.value);
  }

  /** Whether any row matches `where`. */
  async existsBy(where: SQL): Promise<boolean> {
    const [row] = await this.db
      .select({ one: this.idColumn })
      .from(this.table as PgTable)
      .where(where)
      .limit(1);
    return row !== undefined;
  }
}
