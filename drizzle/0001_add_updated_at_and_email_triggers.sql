-- Drizzle's `$onUpdate()` only fires for writes made through Drizzle's own
-- query builder. These triggers make `updated_at` maintenance correct
-- regardless of writer (Supabase Studio edits, raw SQL, a future second
-- consumer), and are the source of truth; `$onUpdate()` is kept in the
-- schema too as a harmless client-side mirror.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON "users"
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER otps_set_updated_at
  BEFORE UPDATE ON "otps"
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER refresh_tokens_set_updated_at
  BEFORE UPDATE ON "refresh_tokens"
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- Replicates Mongoose's schema-level `lowercase: true, trim: true` on
-- `email`, which has no column-level equivalent in Postgres/Drizzle.
CREATE OR REPLACE FUNCTION normalize_user_email()
RETURNS trigger AS $$
BEGIN
  NEW.email = lower(btrim(NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER users_normalize_email
  BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW
  EXECUTE FUNCTION normalize_user_email();
