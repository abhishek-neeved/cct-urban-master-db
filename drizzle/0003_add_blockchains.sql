CREATE TYPE "public"."chain_type" AS ENUM('evm', 'ton', 'solana', 'tron', 'aptos', 'sui');--> statement-breakpoint
CREATE TABLE "blockchains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"symbol" text,
	"icon" text,
	"rpc" text,
	"explorer" text,
	"wallet_provider" text,
	"order" integer,
	"chain_id" text,
	"start_block" integer,
	"is_testnet" boolean DEFAULT false NOT NULL,
	"chain_type" "chain_type",
	"is_enabled" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blockchains_name_unique" UNIQUE("name"),
	CONSTRAINT "blockchains_symbol_unique" UNIQUE("symbol"),
	CONSTRAINT "blockchains_rpc_unique" UNIQUE("rpc"),
	CONSTRAINT "blockchains_order_unique" UNIQUE("order")
);
--> statement-breakpoint
CREATE INDEX "blockchains_is_testnet_idx" ON "blockchains" USING btree ("is_testnet");--> statement-breakpoint
CREATE INDEX "blockchains_name_idx" ON "blockchains" USING btree ("name");--> statement-breakpoint
CREATE INDEX "blockchains_symbol_idx" ON "blockchains" USING btree ("symbol");