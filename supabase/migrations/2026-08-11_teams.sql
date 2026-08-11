-- Teams: an Admin can group Employees under a Manager, and that Manager is
-- then scoped to just their own team everywhere in the app (People tab,
-- workload, the "Assigned Employee" picker, the assignments list). Admin
-- is unaffected and continues to see/manage everything across every team.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste
-- this whole file > Run. Every statement is idempotent (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS before CREATE), so it's safe to
-- re-run if something fails partway through.
--
-- IMPORTANT — read before running: step 3 drops every existing RLS policy
-- on profiles/assignments/comments/activity_log/teams (whatever they're
-- currently named) and step 4 onward recreates them from scratch. If you
-- have hand-added policies on these tables beyond what shipped with this
-- app, note them down first — this migration does not preserve them.
--
-- After running: existing Managers won't see any employees/assignments
-- besides their own until you create a team for them (Admin dashboard >
-- Teams > + New Team) and assign members to it (People > edit a member >
-- Team field). That's expected, not a bug — before this migration every
-- Manager could see everyone; team scoping only takes effect once a
-- Manager actually leads a team.

-- 1. Teams table ----------------------------------------------------------
create extension if not exists pgcrypto; -- provides gen_random_uuid()

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  manager_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists team_id uuid references public.teams(id) on delete set null;

alter table public.teams enable row level security;

-- 2. Helper functions -------------------------------------------------------
-- security definer: these run with elevated privilege so an RLS policy can
-- look up the caller's own role/team without recursing back through the
-- very policy that's calling it. Each only ever returns a single scalar
-- (role, or a team uuid) derived from auth.uid() — never another user's row.
create or replace function public.current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.teams where manager_id = auth.uid()),
    (select team_id from public.profiles where id = auth.uid())
  );
$$;

-- 3. Reset existing policies on the affected tables -------------------------
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'assignments', 'comments', 'activity_log', 'teams')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- 4. profiles -----------------------------------------------------------
create policy profiles_select on public.profiles for select using (
  auth.uid() is not null and (
    public.current_role() = 'Admin'
    or id = auth.uid()
    or team_id = public.my_team_id()
  )
);

create policy profiles_insert on public.profiles for insert with check (
  public.current_role() = 'Admin'
  or (public.current_role() = 'Manager' and (team_id is null or team_id = public.my_team_id()))
);

create policy profiles_update on public.profiles for update using (
  public.current_role() = 'Admin'
  or id = auth.uid()
  or team_id = public.my_team_id()
) with check (
  public.current_role() = 'Admin'
  or id = auth.uid()
  or team_id = public.my_team_id()
);

create policy profiles_delete on public.profiles for delete using (
  public.current_role() = 'Admin'
  or (public.current_role() = 'Manager' and team_id = public.my_team_id())
);

-- 5. teams ------------------------------------------------------------------
create policy teams_select on public.teams for select using (
  auth.uid() is not null and (
    public.current_role() = 'Admin'
    or manager_id = auth.uid()
    or id = (select team_id from public.profiles where id = auth.uid())
  )
);

create policy teams_insert on public.teams for insert with check (public.current_role() = 'Admin');
create policy teams_update on public.teams for update using (public.current_role() = 'Admin') with check (public.current_role() = 'Admin');
create policy teams_delete on public.teams for delete using (public.current_role() = 'Admin');

-- 6. assignments --------------------------------------------------------
create policy assignments_select on public.assignments for select using (
  public.current_role() = 'Admin'
  or assigned_to = auth.uid()
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id = public.my_team_id()
      ))
);

create policy assignments_insert on public.assignments for insert with check (
  public.current_role() = 'Admin'
  or (assigned_by = auth.uid() and (
        assigned_to = auth.uid()
        or (public.current_role() = 'Manager' and assigned_to in (
              select id from public.profiles where team_id = public.my_team_id()
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
) with check (
  public.current_role() = 'Admin'
  or assigned_to = auth.uid()
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id = public.my_team_id()
      ))
);

create policy assignments_delete on public.assignments for delete using (
  public.current_role() = 'Admin'
  or assigned_by = auth.uid()
  or (public.current_role() = 'Manager' and assigned_to in (
        select id from public.profiles where team_id = public.my_team_id()
      ))
);

-- 7. comments -----------------------------------------------------------
create policy comments_select on public.comments for select using (
  exists (
    select 1 from public.assignments a where a.id = comments.assignment_id and (
      public.current_role() = 'Admin'
      or a.assigned_to = auth.uid()
      or a.assigned_by = auth.uid()
      or (public.current_role() = 'Manager' and a.assigned_to in (
            select id from public.profiles where team_id = public.my_team_id()
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
    )
  )
);

-- 8. activity_log -------------------------------------------------------
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
    )
  )
);

create policy activity_log_insert on public.activity_log for insert with check (user_id = auth.uid());
