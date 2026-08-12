-- Extends the org chart one level deeper: Intern/External now report to a
-- specific Employee (their "supervisor"), not just to the team as a whole.
-- Full chain after this migration:
--
--   Admin  >  Manager (leads a Team)  >  Employee (member of a Team)  >  Intern/External (reports to one Employee)
--
-- An Employee gets the same kind of scoped authority over their own
-- Interns/Externals that a Manager already has over their team: create/
-- edit/delete assignments for them, add/edit/reset-password/remove their
-- People rows, see their combined workload. It's the exact same pattern as
-- Manager->Team from supabase/migrations/2026-08-11_teams.sql, one tier
-- down, keyed by a new `supervisor_id` column instead of `team_id`.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste
-- this whole file > Run. Every statement is idempotent, so it's safe to
-- re-run if something fails partway through.
--
-- IMPORTANT — read before running: this drops and recreates every existing
-- RLS policy on profiles/assignments/comments/activity_log (same tables
-- 2026-08-11_teams.sql touched). If you've hand-added policies on these
-- tables beyond what shipped with this app, note them down first.
--
-- Bonus fix bundled in here: the profiles_select/profiles_update policies
-- from the teams migration granted the `team_id = my_team_id()` clause to
-- *any* signed-in staff member, not just Manager (Postgres RLS has no
-- concept of "only I intended this for Managers" — an ungated clause is
-- available to everyone it evaluates true for). In practice that meant any
-- Employee/Intern/External could already read or edit any teammate's
-- profile row via a direct API call, bypassing what the UI shows. This
-- migration gates that clause to `current_role() = 'Manager'` explicitly,
-- and likewise restricts what role Manager/Employee are allowed to save via
-- insert/update (Employee/Intern/External only — neither can promote
-- someone to Manager/Admin). Admin is untouched and still sees/manages
-- everything.
--
-- After running: existing Interns/Externals have supervisor_id = null
-- (unsupervised) until you open People > Edit on each one (or set it while
-- adding new ones) and pick their Employee. That's expected, not a bug —
-- Manager/Admin access to them is unaffected either way; only the new
-- Employee-level access depends on it.

-- 1. New column -------------------------------------------------------------
alter table public.profiles
  add column if not exists supervisor_id uuid references public.profiles(id) on delete set null;

-- 2. Reset existing policies on the affected tables --------------------------
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'assignments', 'comments', 'activity_log')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- 3. profiles -----------------------------------------------------------
create policy profiles_select on public.profiles for select using (
  auth.uid() is not null and (
    public.current_role() = 'Admin'
    or id = auth.uid()
    or (public.current_role() = 'Manager' and team_id = public.my_team_id())
    or (public.current_role() = 'Employee' and supervisor_id = auth.uid())
  )
);

create policy profiles_insert on public.profiles for insert with check (
  public.current_role() = 'Admin'
  or (
    public.current_role() = 'Manager'
    and role in ('Employee', 'Intern', 'External')
    and (team_id is null or team_id = public.my_team_id())
  )
  or (
    public.current_role() = 'Employee'
    and role in ('Intern', 'External')
    and supervisor_id = auth.uid()
    -- Same null-safe "stay in my own team" rule as the update policy below.
    and team_id is not distinct from public.my_team_id()
  )
);

create policy profiles_update on public.profiles for update using (
  public.current_role() = 'Admin'
  or id = auth.uid()
  or (public.current_role() = 'Manager' and team_id = public.my_team_id())
  or (public.current_role() = 'Employee' and supervisor_id = auth.uid())
) with check (
  public.current_role() = 'Admin'
  or id = auth.uid()
  or (public.current_role() = 'Manager' and team_id = public.my_team_id() and role in ('Employee', 'Intern', 'External'))
  or (
    public.current_role() = 'Employee'
    and supervisor_id = auth.uid()
    and role in ('Intern', 'External')
    -- Stops an Employee from using their own-reports update grant to move
    -- someone into a different team_id than the one they're already in
    -- (my_team_id() falls back to an Employee's own team_id, same as
    -- theirs) -- "is not distinct from" instead of "=" so this still holds
    -- when both sides are null (an Employee not yet on any team).
    and team_id is not distinct from public.my_team_id()
  )
);

create policy profiles_delete on public.profiles for delete using (
  public.current_role() = 'Admin'
  or (public.current_role() = 'Manager' and team_id = public.my_team_id())
  or (public.current_role() = 'Employee' and supervisor_id = auth.uid())
);

-- 4. assignments --------------------------------------------------------
create policy assignments_select on public.assignments for select using (
  public.current_role() = 'Admin'
  or assigned_to = auth.uid()
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id = public.my_team_id()
      ))
  or (public.current_role() = 'Employee' and assigned_to in (
        select id from public.profiles where supervisor_id = auth.uid()
      ))
);

create policy assignments_insert on public.assignments for insert with check (
  public.current_role() = 'Admin'
  or (assigned_by = auth.uid() and (
        assigned_to = auth.uid()
        or (public.current_role() = 'Manager' and assigned_to in (
              select id from public.profiles where team_id = public.my_team_id()
            ))
        or (public.current_role() = 'Employee' and assigned_to in (
              select id from public.profiles where supervisor_id = auth.uid()
            ))
      ))
);

create policy assignments_update on public.assignments for update using (
  public.current_role() = 'Admin'
  or assigned_to = auth.uid()
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id = public.my_team_id()
      ))
  or (public.current_role() = 'Employee' and assigned_to in (
        select id from public.profiles where supervisor_id = auth.uid()
      ))
) with check (
  public.current_role() = 'Admin'
  or assigned_to = auth.uid()
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id = public.my_team_id()
      ))
  or (public.current_role() = 'Employee' and assigned_to in (
        select id from public.profiles where supervisor_id = auth.uid()
      ))
);

create policy assignments_delete on public.assignments for delete using (
  public.current_role() = 'Admin'
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id = public.my_team_id()
      ))
  or (public.current_role() = 'Employee' and assigned_to in (
        select id from public.profiles where supervisor_id = auth.uid()
      ))
);

-- 5. comments -----------------------------------------------------------
create policy comments_select on public.comments for select using (
  exists (
    select 1 from public.assignments a where a.id = comments.assignment_id and (
      public.current_role() = 'Admin'
      or a.assigned_to = auth.uid()
      or a.assigned_by = auth.uid()
      or (public.current_role() = 'Manager' and a.assigned_to in (
            select id from public.profiles where team_id = public.my_team_id()
          ))
      or (public.current_role() = 'Employee' and a.assigned_to in (
            select id from public.profiles where supervisor_id = auth.uid()
          ))
    )
  )
);

create policy comments_insert on public.comments for insert with check (
  user_id = auth.uid() and exists (
    select 1 from public.assignments a where a.id = comments.assignment_id and (
      public.current_role() = 'Admin'
      or a.assigned_to = auth.uid()
      or a.assigned_by = auth.uid()
      or (public.current_role() = 'Manager' and a.assigned_to in (
            select id from public.profiles where team_id = public.my_team_id()
          ))
      or (public.current_role() = 'Employee' and a.assigned_to in (
            select id from public.profiles where supervisor_id = auth.uid()
          ))
    )
  )
);

-- 6. activity_log -------------------------------------------------------
create policy activity_log_select on public.activity_log for select using (
  public.current_role() = 'Admin'
  or user_id = auth.uid()
  or exists (
    select 1 from public.assignments a where a.id = activity_log.assignment_id and (
      a.assigned_to = auth.uid()
      or a.assigned_by = auth.uid()
      or (public.current_role() = 'Manager' and a.assigned_to in (
            select id from public.profiles where team_id = public.my_team_id()
          ))
      or (public.current_role() = 'Employee' and a.assigned_to in (
            select id from public.profiles where supervisor_id = auth.uid()
          ))
    )
  )
);

create policy activity_log_insert on public.activity_log for insert with check (user_id = auth.uid());
