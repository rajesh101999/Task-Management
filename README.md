# Assignment Tracker Dashboard

A small assignment tracker with email/password login and three roles:
**Admin**, **Manager**, and **Employee** (Admin and Manager both get full
access — Admin is a separate label for the same permission tier, not a
replacement for Manager). Static HTML/CSS/JS frontend (no build step,
hosted on GitHub Pages), backed by a free [Supabase](https://supabase.com)
project (Postgres + Auth) so accounts and assignments are shared across
every device — not just the browser that created them.

## Run it

Open `index.html` directly in a browser, or serve the folder locally:

```
npx serve .
```

No local database needed — the app talks straight to the hosted Supabase
project configured in `js/supabaseClient.js`.

## First login

There's no self-service sign-up — accounts are created by a Manager or
Admin from the **People** tab (see below). The very first account is
bootstrapped directly in the Supabase dashboard: create the user under
**Authentication → Users**, then give it a matching row in the `profiles`
table with `role = 'Admin'` (or `'Manager'`). From there, that account can
add everyone else from the dashboard's People tab, and (if Admin) set up
Teams to scope Managers to their own people.

## What's included

- **Auth** (`js/auth.js`) — sign in / log out via Supabase Auth (hashed
  passwords, real sessions — not stored in the browser). No public
  sign-up page — `signup.html` is just a redirect stub kept around in
  case of old links/bookmarks.
- **Admin view** — everything a Manager can do, plus the **Teams** tab:
  create a team, assign it a Manager, and that Manager is then scoped to
  just that team everywhere in the app (People tab, workload, the
  "Assigned Employee" picker, the assignments list). A Manager with no
  team yet only sees themselves until an Admin sets one up for them.
- **Manager view** — create, edit, delete assignments for their own team;
  assign to any of their team's employees; see their team's assignments
  and workload.
- **People tab (Manager/Admin)** — add, edit, or remove Admin, Manager, and
  Employee accounts (name, ID, email, division, team, password) directly
  from the dashboard. A Manager only sees/adds their own team's people; an
  Admin sees everyone and can move an Employee between teams via the Team
  field. A manager/admin can edit their own details too, except their own
  role, and can't delete the account they're currently signed in as.
  Email/password changes for *other* members aren't supported from this
  tab — Supabase Auth only allows an account to change its own login
  credentials, so those fields are locked when editing someone else.
- **Employee view** — see only assignments assigned to them; update status
  and progress; add comments.
- **Dashboard KPIs** — Total, Pending, In Progress, Completed, Overdue.
- **Status workflow** — Pending → Accepted → In Progress → Under Review →
  Completed, plus On Hold / Blocked / Cancelled.
- **CSV export** of the currently filtered table.
- All data (users + teams + assignments + activity log + comments) lives
  in Postgres, protected by Row Level Security: Employees only ever see
  what's assigned to them, a Manager only their own team, Admin sees
  everything.

## Backend (Supabase)

- `js/supabaseClient.js` holds the project URL and the **anon public**
  key. That key is meant to be exposed client-side — access is enforced
  by the database's Row Level Security policies, not by hiding the key.
- The database schema (tables + RLS policies) originally lived only in
  the Supabase dashboard's SQL Editor history. Changes going forward are
  checked in under `supabase/migrations/` — run each new file once in
  the dashboard's SQL Editor (they're idempotent, safe to re-run). Five
  tables: `profiles`, `teams`, `assignments`, `comments`, `activity_log`.
- Adding a team member signs the new account up on a second, memory-only
  Supabase client so the Manager's own session is never disturbed — see
  `addTeamMember` in `js/auth.js`.

## File structure

```
index.html              Sign-in page
signup.html              Redirect stub (old sign-up page, retired)
dashboard.html            Role-aware dashboard (Admin / Manager / Employee), incl. People + Teams tabs
css/style.css              All styling
js/supabaseClient.js        Shared Supabase client (project URL + anon key)
js/auth.js                Sessions, login/logout, team member + team CRUD
js/data.js                Assignments, comments, activity log CRUD
js/dashboard.js             Dashboard rendering and UI wiring
supabase/migrations/        SQL to run in the Supabase SQL Editor, in order
```
