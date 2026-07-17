import type { PaginatedResult } from '@nvcct/db-entities';
import { BlockchainSearchParams, IBlockchainRepository } from './blockchain.repository';
import { Blockchain } from './blockchain.types';

export class BlockchainService {
  constructor(private readonly blockchains: IBlockchainRepository) {}

  async list(params: BlockchainSearchParams): Promise<PaginatedResult<Blockchain>> {
    return this.blockchains.search(params);
  }
}
