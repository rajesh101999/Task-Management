-- Fixes "Assigned By" showing blank ("—") in the assignment detail modal
-- for anyone who didn't already have RLS visibility into the assigner's
-- profile -- most commonly an Intern/External looking at a task their
-- supervising Employee (or a Manager/Admin) assigned them: profiles_select
-- (supabase/migrations/2026-08-16_manager-multi-team.sql) never granted
-- Intern/External any clause for reading someone *above* them, only their
-- own row (id = auth.uid()) -- so js/data.js ownerName couldn't find the
-- assigner in the fetched user list and fell back to its '—' placeholder,
-- even though assignments.assigned_by was set correctly all along. This
-- wasn't only an Intern/External gap -- e.g. an Employee looking at a task
-- a Manager assigned them directly had the same hole.
--
-- Fix: let anyone see the profile of whoever assigned *them* one of their
-- own assignments, regardless of role. Narrowly scoped on purpose --
-- doesn't hand out visibility into unrelated teammates, just the specific
-- person who assigned a task you can already see.
--
-- IMPORTANT — this replaces a first version of this same file that broke
-- login for everyone. That version put the "who assigned me a task" check
-- straight into profiles_select as a raw `exists (select ... from
-- assignments ...)`. assignments_select in turn queries public.profiles
-- (its Manager/Employee clauses). Two RLS-protected tables each querying
-- straight into the other creates a cycle -- Postgres has to keep
-- re-evaluating one policy to evaluate the other -- and it broke *every*
-- profiles query, including the one js/auth.js getSession() runs right
-- after sign-in to load your role, which is exactly what made login fail.
-- The existing current_role()/my_team_id()/my_team_ids() helpers already
-- avoid this the same way: a SECURITY DEFINER function's own table lookups
-- run as the function's owner (the table owner, effectively bypassing RLS
-- on that one inner read) instead of re-entering the caller's policies, so
-- nothing they touch can loop back through the policy that called them.
-- my_task_assigners() below follows that exact pattern.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste
-- this whole file > Run, after every earlier migration (needs profiles_select
-- to already exist). Safe to re-run -- CREATE OR REPLACE / ALTER POLICY just
-- redefine the same thing each time.

create or replace function public.my_task_assigners() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct assigned_by from public.assignments where assigned_to = auth.uid();
$$;

alter policy profiles_select on public.profiles using (
  auth.uid() is not null and (
    public.current_role() = 'Admin'
    or id = auth.uid()
    or (public.current_role() = 'Manager' and team_id in (select public.my_team_ids()))
    or (public.current_role() = 'Employee' and supervisor_id = auth.uid())
    or id in (select public.my_task_assigners())
  )
);
