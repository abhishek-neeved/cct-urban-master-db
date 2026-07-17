import { BlockchainRepository } from '@modules/blockchain/blockchain.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('BlockchainRepository (integration)', () => {
  let repository: BlockchainRepository;

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new BlockchainRepository();
  });

  const seed = () =>
    Promise.all([
      repository.create({
        name: 'Ethereum',
        symbol: 'ETH',
        chainType: 'evm',
        isTestnet: false,
      }),
      repository.create({
        name: 'Ethereum Sepolia',
        symbol: 'SEP',
        chainType: 'evm',
        isTestnet: true,
      }),
      repository.create({
        name: 'Solana',
        symbol: 'SOL',
        chainType: 'solana',
        isTestnet: false,
      }),
      repository.create({
        name: 'Tron',
        symbol: 'TRX',
        chainType: 'tron',
        isTestnet: false,
      }),
    ]);

  it('returns every blockchain when no filter is given', async () => {
    await seed();
    const result = await repository.search({ page: 1, limit: 10 });

    expect(result.data).toHaveLength(4);
    expect(result.meta).toEqual({
      page: 1,
      limit: 10,
      total: 4,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });

  it('searches case-insensitively by name', async () => {
    await seed();
    const result = await repository.search({ search: 'ether', page: 1, limit: 10 });

    expect(result.data.map((b) => b.name).sort()).toEqual(['Ethereum', 'Ethereum Sepolia']);
    expect(result.meta.total).toBe(2);
  });

  it('searches case-insensitively by symbol', async () => {
    await seed();
    const result = await repository.search({ search: 'sol', page: 1, limit: 10 });

    expect(result.data.map((b) => b.name)).toEqual(['Solana']);
  });

  it('filters by chainType', async () => {
    await seed();
    const result = await repository.search({ chainType: 'evm', page: 1, limit: 10 });

    expect(result.data.map((b) => b.name).sort()).toEqual(['Ethereum', 'Ethereum Sepolia']);
    expect(result.meta.total).toBe(2);
  });

  it('combines search and chainType filters', async () => {
    await seed();
    const result = await repository.search({
      search: 'sepolia',
      chainType: 'evm',
      page: 1,
      limit: 10,
    });

    expect(result.data.map((b) => b.name)).toEqual(['Ethereum Sepolia']);
  });

  it('returns nothing when the filter matches no rows', async () => {
    await seed();
    const result = await repository.search({ search: 'nonexistent-chain', page: 1, limit: 10 });

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.totalPages).toBe(0);
  });

  it('paginates correctly, with totals reflecting the filter not the whole table', async () => {
    await seed();
    const page1 = await repository.search({ chainType: 'evm', page: 1, limit: 1 });
    const page2 = await repository.search({ chainType: 'evm', page: 2, limit: 1 });

    expect(page1.data).toHaveLength(1);
    expect(page1.meta).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(page1.meta.hasNextPage).toBe(true);
    expect(page1.meta.hasPrevPage).toBe(false);

    expect(page2.data).toHaveLength(1);
    expect(page2.meta.hasNextPage).toBe(false);
    expect(page2.meta.hasPrevPage).toBe(true);

    // The two pages together cover both (and only both) evm chains, no overlap.
    const names = [...page1.data, ...page2.data].map((b) => b.name).sort();
    expect(names).toEqual(['Ethereum', 'Ethereum Sepolia']);
  });
});
