-- Completion approval: an Intern/External can still mark their own
-- assignment "Completed" from the UI, but it doesn't actually land as
-- Completed -- it's redirected to "Pending Approval" instead, and stays
-- there until their reporting manager (whoever above them already has
-- access to the row: their supervising Employee, a Manager, or Admin)
-- clicks Approve, which is the one thing that promotes it to Completed
-- (js/dashboard.js approveCompletion). js/dashboard.js already does this
-- redirect client-side (requestsApproval, used in onSaveTask/onSaveStatus),
-- but that's a UI nicety, not a security boundary -- this trigger is what
-- actually enforces it, the same way the People tab's role picker is backed
-- by a DB check in 2026-08-12_employee-supervisors.sql rather than trusting
-- the frontend alone.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste
-- this whole file > Run. Idempotent (CREATE OR REPLACE / DROP ... IF EXISTS
-- before CREATE), safe to re-run -- including re-running over the previous
-- version of this file, which rejected the write instead of redirecting it.

create or replace function public.block_self_completion() returns trigger
language plpgsql as $$
begin
  if new.status = 'Completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'Completed')
     and public.current_role() in ('Intern', 'External')
     and new.assigned_to = auth.uid() then
    new.status := 'Pending Approval';
    new.progress := 100;
  end if;
  return new;
end;
$$;

drop trigger if exists assignments_block_self_completion on public.assignments;
create trigger assignments_block_self_completion
  before insert or update on public.assignments
  for each row execute function public.block_self_completion();
