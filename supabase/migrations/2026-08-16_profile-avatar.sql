-- Adds a profile picture field. Stored as a data URL (base64) directly on
-- the row rather than in Supabase Storage, so no bucket/policy setup is
-- needed — the existing profiles RLS policies (id = auth.uid() for self,
-- plus whatever a Manager/Employee/Admin can already see) already cover
-- reading and writing this column, since RLS in Postgres is row-level, not
-- column-level. The dashboard resizes/compresses images client-side (see
-- js/dashboard.js) before it ever reaches this column, so rows stay small.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste
-- this whole file > Run. Idempotent, safe to re-run.

alter table public.profiles
  add column if not exists avatar_url text;
