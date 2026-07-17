import { vi, type Mocked } from 'vitest';
import { BlockchainService } from '@modules/blockchain/blockchain.service';
import { IBlockchainRepository } from '@modules/blockchain/blockchain.repository';

describe('BlockchainService', () => {
  it('delegates to the repository search with the given params', async () => {
    const result = {
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
    };
    const blockchains = {
      search: vi.fn().mockResolvedValue(result),
    } as unknown as Mocked<IBlockchainRepository>;
    const service = new BlockchainService(blockchains);

    const params = { search: 'eth', chainType: 'evm' as const, page: 2, limit: 5 };
    const returned = await service.list(params);

    expect(blockchains.search).toHaveBeenCalledWith(params);
    expect(returned).toBe(result);
  });
});
