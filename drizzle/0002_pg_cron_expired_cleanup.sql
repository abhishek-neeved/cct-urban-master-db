-- Postgres has no TTL-index equivalent to Mongo's automatic expiry sweep.
-- pg_cron is Supabase's documented way to replicate that server-side purge.
--
-- IMPORTANT: this migration is Supabase-project-only (or the Supabase CLI's
-- local dev stack, which bundles pg_cron). It will fail against a bare
-- local/CI Postgres container that doesn't have the extension available —
-- run 0000/0001 there, and apply this one separately against the real
-- Supabase project via the dashboard SQL editor, `supabase db push`, or a
-- privileged migration run.
CREATE EXTENSION IF NOT EXISTS pg_cron;
--> statement-breakpoint

SELECT cron.schedule(
  'purge-expired-otps',
  '*/15 * * * *',
  $$DELETE FROM otps WHERE expires_at < now()$$
);
--> statement-breakpoint

SELECT cron.schedule(
  'purge-expired-refresh-tokens',
  '*/15 * * * *',
  $$DELETE FROM refresh_tokens WHERE expires_at < now()$$
);
