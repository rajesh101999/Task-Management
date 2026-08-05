# Assignment Tracker Dashboard

A small assignment tracker with email/password login and two roles:
**Manager** and **Employee**. Static HTML/CSS/JS frontend (no build step,
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

There's no self-service sign-up — accounts are created by a Manager from
the **Team** tab (see below). The very first account (a Manager) is
bootstrapped directly in the Supabase dashboard: create the user under
**Authentication → Users**, then give it a matching row in the `profiles`
table with `role = 'Manager'`. From there, that Manager can add everyone
else from the dashboard's Team tab.

## What's included

- **Auth** (`js/auth.js`) — sign in / log out via Supabase Auth (hashed
  passwords, real sessions — not stored in the browser). No public
  sign-up page — `signup.html` is just a redirect stub kept around in
  case of old links/bookmarks.
- **Manager view** — create, edit, delete assignments; assign to any
  registered employee; see every assignment, workload, and activity feed.
- **Team tab (Manager only)** — add, edit, or remove Manager and Employee
  accounts (name, ID, email, division, password) directly from the
  dashboard. A manager can edit their own details too, except their own
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
- All data (users + assignments + activity log + comments) lives in
  Postgres, protected by Row Level Security so Employees only ever see
  what's assigned to them, while Managers see everything.

## Backend (Supabase)

- `js/supabaseClient.js` holds the project URL and the **anon public**
  key. That key is meant to be exposed client-side — access is enforced
  by the database's Row Level Security policies, not by hiding the key.
- The database schema (tables + RLS policies) lives in the project's
  Supabase dashboard under SQL Editor's query history. Four tables:
  `profiles`, `assignments`, `comments`, `activity_log`.
- Adding a team member signs the new account up on a second, memory-only
  Supabase client so the Manager's own session is never disturbed — see
  `addTeamMember` in `js/auth.js`.

## File structure

```
index.html              Sign-in page
signup.html              Redirect stub (old sign-up page, retired)
dashboard.html            Role-aware dashboard (Manager / Employee), incl. Team tab
css/style.css              All styling
js/supabaseClient.js        Shared Supabase client (project URL + anon key)
js/auth.js                Sessions, login/logout, team member CRUD
js/data.js                Assignments, comments, activity log CRUD
js/dashboard.js             Dashboard rendering and UI wiring
```
