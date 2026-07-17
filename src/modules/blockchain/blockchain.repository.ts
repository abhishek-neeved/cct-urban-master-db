import { and, eq, ilike, or, type SQL } from 'drizzle-orm';
import {
  blockchainsTable,
  type BlockchainRow,
  type ChainType,
  type NewBlockchain,
  type PaginatedResult,
} from '@nvcct/db-entities';
import { db } from '@shared/config/database';
import { BaseRepository } from '@shared/repositories/base.repository';
import { Blockchain, toBlockchain } from './blockchain.types';

export interface BlockchainSearchParams {
  /** Case-insensitive partial match against `name` or `symbol`. */
  search?: string;
  chainType?: ChainType;
  page: number;
  limit: number;
}

export interface IBlockchainRepository {
  search(params: BlockchainSearchParams): Promise<PaginatedResult<Blockchain>>;
}

/**
 * Read-only reference-data store for supported blockchains. Only `search` is
 * exposed beyond the inherited generic CRUD — the chain list is seeded/managed
 * out of band, not created or edited through this API (yet).
 */
export class BlockchainRepository
  extends BaseRepository<typeof blockchainsTable, BlockchainRow, Blockchain, NewBlockchain>
  implements IBlockchainRepository
{
  constructor() {
    super(db, blockchainsTable, blockchainsTable.id, toBlockchain);
  }

  async search({
    search,
    chainType,
    page,
    limit,
  }: BlockchainSearchParams): Promise<PaginatedResult<Blockchain>> {
    const conditions: SQL[] = [];
    if (search) {
      const term = `%${search}%`;
      conditions.push(
        or(ilike(blockchainsTable.name, term), ilike(blockchainsTable.symbol, term)) as SQL
      );
    }
    if (chainType) {
      conditions.push(eq(blockchainsTable.chainType, chainType));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return this.findPaginated(where, page, limit);
  }
}
