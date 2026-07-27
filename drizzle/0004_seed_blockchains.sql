-- Seeds the initial set of supported mainnet chains, one per major network
-- family (evm/ton/solana/tron/aptos/sui). Core fields only — rpc/explorer/icon/
-- walletProvider/isEnabled/startBlock are left NULL for the consuming app to
-- fill in per its own infra (RPC endpoints, feature flags, etc.).
-- ON CONFLICT (name) DO NOTHING makes this safe to re-run (e.g. re-applied
-- against an environment that already has some of these rows).
INSERT INTO "blockchains" ("name", "symbol", "chain_type", "chain_id", "is_testnet", "order") VALUES
	('Ethereum', 'ETH', 'evm', '1', false, 1),
	('BNB Chain', 'BNB', 'evm', '56', false, 2),
	('Polygon', 'POL', 'evm', '137', false, 3),
	('Solana', 'SOL', 'solana', NULL, false, 4),
	('Tron', 'TRX', 'tron', NULL, false, 5),
	('TON', 'TON', 'ton', NULL, false, 6),
	('Aptos', 'APT', 'aptos', NULL, false, 7),
	('Sui', 'SUI', 'sui', NULL, false, 8)
ON CONFLICT ("name") DO NOTHING;