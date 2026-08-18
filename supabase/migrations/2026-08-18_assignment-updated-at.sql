-- Adds assignments.updated_at, kept current by a trigger on every UPDATE —
-- powers the Reports tab's "Download Today's Report" button (js/dashboard.js
-- isUpdatedToday), which needs to know what changed today regardless of
-- which column changed (status, progress, dates, reassignment, ...).
--
-- A trigger instead of setting it from the app (js/data.js updateTask) is
-- deliberate: every UPDATE goes through Postgres regardless of which app
-- code path triggered it, so there's exactly one place this can be missed
-- (nowhere) instead of one per call site.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste
-- this whole file > Run. Idempotent, safe to re-run.

-- 1. New column, backfilled from created_at ---------------------------------
-- (Not "add column ... default now()" — that would stamp every existing
-- row with the migration's run time and make all of them look "updated
-- today" the moment this runs.)
alter table public.assignments add column if not exists updated_at timestamptz;
update public.assignments set updated_at = created_at where updated_at is null;
alter table public.assignments alter column updated_at set default now();
alter table public.assignments alter column updated_at set not null;

-- 2. Trigger to keep it current ----------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assignments_set_updated_at on public.assignments;
create trigger assignments_set_updated_at
  before update on public.assignments
  for each row execute function public.set_updated_at();
