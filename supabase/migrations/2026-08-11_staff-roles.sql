-- Allows the two new staff roles (Intern, External) at the database level.
-- The `profiles` table likely has a CHECK constraint left over from before
-- these existed, restricting `role` to the original three values
-- (Admin/Manager/Employee) -- this finds it (whatever it's actually named)
-- and replaces it with one that includes all five.
--
-- Symptom this fixes: adding an Intern/External appears to fail with
-- "account already exists" on a second attempt, but the person is nowhere
-- to be found in People. What actually happened: Supabase Auth created
-- their login (no role involved), then saving their `profiles` row was
-- rejected by this constraint -- leaving an orphaned login with no profile
-- (invisible everywhere) that permanently reserves the email.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.

do $$
declare con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check check (role in ('Admin', 'Manager', 'Employee', 'Intern', 'External'));
