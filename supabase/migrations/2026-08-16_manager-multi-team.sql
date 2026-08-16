-- Lets one Manager lead more than one Team, instead of needing a separate
-- Manager account per team. `teams.manager_id` already allowed this at the
-- schema level (no uniqueness constraint), but two other things assumed
-- "a Manager leads at most one team":
--
--   1. public.my_team_id() found "the team I manage" with a bare subquery
--      (select id from teams where manager_id = auth.uid()) — that throws
--      "more than one row returned by a subquery" the moment a second team
--      points at the same manager_id, which is exactly what this migration
--      is for. This adds public.my_team_ids() (set-returning) alongside it
--      and repoints every Manager-scoping RLS clause at that instead.
--      my_team_id() itself is untouched — it's still relied on by
--      Employee-role clauses as a null-safe "my own team_id" fallback,
--      which was never a one-team-per-manager assumption to begin with.
--   2. The Admin dashboard's Teams > Edit modal only offered a Manager once
--      they didn't already lead a team (js/dashboard.js openTeamModal) —
--      that's a UI-only restriction, removed in the same commit as this
--      migration, no SQL involved.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste
-- this whole file > Run. Idempotent, safe to re-run.
--
-- IMPORTANT — read before running: like the teams/employee-supervisors
-- migrations before it, this drops and recreates every existing RLS policy
-- on profiles/assignments/comments/activity_log (not teams — those policies
-- already match on manager_id = auth.uid() directly and never assumed a
-- single team, so they're untouched). If you've hand-added policies on
-- these tables beyond what shipped with this app, note them down first.

-- 1. New helper function ----------------------------------------------------
create or replace function public.my_team_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.teams where manager_id = auth.uid();
$$;

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
    or (public.current_role() = 'Manager' and team_id in (select public.my_team_ids()))
    or (public.current_role() = 'Employee' and supervisor_id = auth.uid())
  )
);

create policy profiles_insert on public.profiles for insert with check (
  public.current_role() = 'Admin'
  or (
    public.current_role() = 'Manager'
    and role in ('Employee', 'Intern', 'External')
    and (team_id is null or team_id in (select public.my_team_ids()))
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
  or (public.current_role() = 'Manager' and team_id in (select public.my_team_ids()))
  or (public.current_role() = 'Employee' and supervisor_id = auth.uid())
) with check (
  public.current_role() = 'Admin'
  or id = auth.uid()
  or (public.current_role() = 'Manager' and team_id in (select public.my_team_ids()) and role in ('Employee', 'Intern', 'External'))
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
  or (public.current_role() = 'Manager' and team_id in (select public.my_team_ids()))
  or (public.current_role() = 'Employee' and supervisor_id = auth.uid())
);

-- 4. assignments --------------------------------------------------------
create policy assignments_select on public.assignments for select using (
  public.current_role() = 'Admin'
  or assigned_to = auth.uid()
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id in (select public.my_team_ids())
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
              select id from public.profiles where team_id in (select public.my_team_ids())
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
        select id from public.profiles where team_id in (select public.my_team_ids())
      ))
  or (public.current_role() = 'Employee' and assigned_to in (
        select id from public.profiles where supervisor_id = auth.uid()
      ))
) with check (
  public.current_role() = 'Admin'
  or assigned_to = auth.uid()
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id in (select public.my_team_ids())
      ))
  or (public.current_role() = 'Employee' and assigned_to in (
        select id from public.profiles where supervisor_id = auth.uid()
      ))
);

create policy assignments_delete on public.assignments for delete using (
  public.current_role() = 'Admin'
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id in (select public.my_team_ids())
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
            select id from public.profiles where team_id in (select public.my_team_ids())
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
            select id from public.profiles where team_id in (select public.my_team_ids())
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
            select id from public.profiles where team_id in (select public.my_team_ids())
          ))
      or (public.current_role() = 'Employee' and a.assigned_to in (
            select id from public.profiles where supervisor_id = auth.uid()
          ))
    )
  )
);

create policy activity_log_insert on public.activity_log for insert with check (user_id = auth.uid());
