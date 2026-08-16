# Assignment Tracker Dashboard

A small assignment tracker with email/password login and a five-role org
chart:

```
Admin  >  Manager (leads a Team)  >  Employee (member of a Team)  >  Intern / External (reports to one Employee)
```

Admin, Manager, and Employee each get "manager-style" dashboard access —
create/edit/delete assignments, manage People rows, see workload — scoped
to whoever reports to them: a Manager to their Team, an Employee to their
own Interns/Externals, an Admin to everyone. Admin is a superset alongside
Manager/Employee rather than a replacement for either. Intern and External
sit at the bottom of the chart with identical access to each other — each
can be assigned work and only ever sees their own assignments. Static
HTML/CSS/JS frontend (no build step, hosted on GitHub Pages), backed by a
free [Supabase](https://supabase.com) project (Postgres + Auth) so accounts
and assignments are shared across every device — not just the browser that
created them.

## Run it

Open `index.html` directly in a browser, or serve the folder locally:

```
npx serve .
```

No local database needed — the app talks straight to the hosted Supabase
project configured in `js/supabaseClient.js`.

## First login

There's no self-service sign-up — accounts are created by whoever they'd
report to (Employee, Manager, or Admin) from the **People** tab (see
below). The very first account is bootstrapped directly in the Supabase
dashboard: create the user under
**Authentication → Users**, then give it a matching row in the `profiles`
table with `role = 'Admin'` (or `'Manager'`). From there, that account can
add everyone else from the dashboard's People tab, and (if Admin) set up
Teams to scope Managers to their own people.

## What's included

- **Auth** (`js/auth.js`) — sign in / log out via Supabase Auth (hashed
  passwords, real sessions — not stored in the browser). No public
  sign-up page — `signup.html` is just a redirect stub kept around in
  case of old links/bookmarks.
- **Settings** (header avatar menu, every role) — change your own profile
  photo and/or password. The photo is resized/compressed to a small JPEG
  client-side and saved as a data URL on `profiles.avatar_url`; the password
  change reuses the same self-service path as editing your own row from the
  People tab (Supabase Auth only ever allows an account to change its own
  credentials from client-side code).
- **Admin view** — everything a Manager can do, plus the **Teams** tab:
  create a team, assign it a Manager, and that Manager is then scoped to
  just that team everywhere in the app (People tab, workload, the
  "Assigned Employee" picker, the assignments list). A Manager with no
  team yet only sees themselves until an Admin sets one up for them.
- **Manager view** — create, edit, delete assignments for their own team;
  assign to any of their team's Employees/Interns/Externals; see their
  team's assignments and workload.
- **Employee view** — same shape as a Manager's, one tier down: create,
  edit, delete assignments for their own Interns/Externals (whoever has
  this Employee set as their **Supervisor**); see just those people and
  that combined workload in their own People tab — not the rest of the
  team. Can still only ever see/update their *own* assignments the way an
  Intern/External does, on top of that.
- **People tab (Employee/Manager/Admin)** — add, edit, or remove accounts
  (name, ID, email, division, team, supervisor, password) directly from the
  dashboard, each tier scoped to who reports to them: Employee sees/adds
  just their own Interns/Externals; Manager sees/adds their whole team;
  Admin sees everyone and can move people between teams/supervisors via the
  Team/Supervisor fields. The Role picker itself only offers the roles that
  tier is allowed to create — Employee: Intern/External; Manager:
  Employee/Intern/External; Admin: all five — enforced both in the UI and,
  more importantly, by the database (see `2026-08-12_employee-supervisors.sql`
  below). Everyone can edit their own details too, except their own role,
  and can't delete the account they're currently signed in as. Email
  changes for *other* members still aren't supported from this tab —
  Supabase Auth only allows an account to change its own email. Passwords
  are different: anyone with People access can set a brand new password for
  one of their people via **Reset Password** on that row (the password
  itself is never visible to anyone — it's hashed one-way at signup — this
  sets a new one, it doesn't reveal the old one). That calls the
  `reset-password` Edge Function since only Supabase's admin API can change
  *someone else's* password; see Backend below.
- **Intern / External view** — see only assignments assigned to them;
  update status and progress; add comments. Identical access to each other
  — just a different label for org-chart purposes.
- **Dashboard KPIs** — Total, Pending, In Progress, Completed, Overdue.
- **Status workflow** — Pending → Accepted → In Progress → Under Review →
  Completed, plus On Hold / Blocked / Cancelled.
- **CSV export** of the currently filtered table.
- All data (users + teams + assignments + activity log + comments) lives
  in Postgres, protected by Row Level Security, matching the org chart at
  the top of this file: Intern/External only ever see what's assigned to
  them, an Employee only their own Interns/Externals (via `supervisor_id`),
  a Manager only their own team (via `team_id`), Admin sees everything.

## Backend (Supabase)

- `js/supabaseClient.js` holds the project URL and the **anon public**
  key. That key is meant to be exposed client-side — access is enforced
  by the database's Row Level Security policies, not by hiding the key.
- The database schema (tables + RLS policies) originally lived only in
  the Supabase dashboard's SQL Editor history. Changes going forward are
  checked in under `supabase/migrations/` — run each new file once, **in
  order**, in the dashboard's SQL Editor (they're idempotent, safe to
  re-run). Five tables: `profiles`, `teams`, `assignments`, `comments`,
  `activity_log`. `2026-08-12_employee-supervisors.sql` is the one that adds
  `profiles.supervisor_id` and the Employee-level RLS policies described
  above — run it before expecting Employee accounts to see the People/
  workload/assignment access this README describes.
  `2026-08-16_profile-avatar.sql` adds `profiles.avatar_url` (a resized data
  URL, not a Storage file — no bucket to configure) — run it before the
  header's **Settings** menu can save a profile photo.
- Adding a team member signs the new account up on a second, memory-only
  Supabase client so the signed-in Employee/Manager/Admin's own session is
  never disturbed — see `addTeamMember` in `js/auth.js`.
- `supabase/functions/reset-password/` is an Edge Function — the one place
  the **service_role** key is used, since resetting someone *else's*
  password requires Supabase's admin API, which browser code can never be
  trusted with. Deploy it from the Supabase dashboard: **Edge Functions →
  Deploy a new function**, name it exactly `reset-password`, paste in the
  file's contents, **Deploy**. No secrets to configure — `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are injected
  automatically. The function re-checks the caller's role itself (Admin, or
  a Manager/Employee acting on their own people) — it doesn't trust the
  frontend. If you deployed this function before Employee gained People
  access, redeploy it (same steps) to pick up that check.

## File structure

```
index.html              Sign-in page
signup.html              Redirect stub (old sign-up page, retired)
dashboard.html            Role-aware dashboard (Admin / Manager / Employee / Intern / External), incl. People + Teams tabs
css/style.css              All styling
js/supabaseClient.js        Shared Supabase client (project URL + anon key)
js/auth.js                Sessions, login/logout, team member + team CRUD
js/data.js                Assignments, comments, activity log CRUD
js/dashboard.js             Dashboard rendering and UI wiring
supabase/migrations/        SQL to run in the Supabase SQL Editor, in order
supabase/functions/         Edge Functions to deploy from the Supabase dashboard
```
