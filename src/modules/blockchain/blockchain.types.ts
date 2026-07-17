import type { BlockchainRow, ChainType } from '@nvcct/db-entities';

/** Domain representation of a supported blockchain. */
export interface Blockchain {
  id: string;
  name: string;
  symbol: string | null;
  icon: string | null;
  rpc: string | null;
  explorer: string | null;
  walletProvider: string | null;
  order: number | null;
  chainId: string | null;
  startBlock: number | null;
  isTestnet: boolean;
  chainType: ChainType | null;
  isEnabled: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toBlockchain = (row: BlockchainRow): Blockchain => ({
  id: row.id,
  name: row.name,
  symbol: row.symbol,
  icon: row.icon,
  rpc: row.rpc,
  explorer: row.explorer,
  walletProvider: row.walletProvider,
  order: row.order,
  chainId: row.chainId,
  startBlock: row.startBlock,
  isTestnet: row.isTestnet,
  chainType: row.chainType,
  isEnabled: row.isEnabled,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
