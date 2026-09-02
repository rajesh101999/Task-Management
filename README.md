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
- **Theme** (header moon/sun icon, every role, `index.html` too) — Light,
  Dark, or System, saved to `localStorage` (no account/database involved) so
  it's per-browser, not per-person. System just follows the OS's light/dark
  setting live via `prefers-color-scheme` — there's nothing to store for it.
  An inline snippet at the top of each page's `<head>` applies a saved
  Light/Dark choice before the stylesheet loads, so there's no flash of the
  wrong theme on load.
- **Admin view** — everything a Manager can do, plus the **Teams** tab:
  create a team, assign it a Manager, and that Manager is then scoped to
  that team everywhere in the app (People tab, workload, the "Assigned
  Employee" picker, the assignments list). A Manager can lead more than one
  team — just create/edit another team and assign it to the same Manager;
  their access becomes the union of every team they lead. A Manager with no
  team yet only sees themselves until an Admin sets one up for them.
- **Manager view** — create, edit, delete assignments for their team(s);
  assign to any of their team's Employees/Interns/Externals; see their
  team's assignments and workload. Adding/editing a member offers a Team
  picker whenever the Manager leads more than one team, so they choose
  which one a new hire lands on.
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
  — just a different label for org-chart purposes. Can pick "Completed" for
  their own assignment same as any other status, but it doesn't actually
  land as Completed — see Status workflow below.
- **Dashboard KPIs** — Total, Pending, In Progress, Completed, Overdue.
- **Status workflow** — Pending → Accepted → In Progress → Under Review →
  Pending Approval → Completed, plus On Hold / Blocked / Cancelled. An
  Intern/External marking their own assignment "Completed" doesn't complete
  it — it's redirected to **Pending Approval** instead (progress jumps to
  100% either way, since their own work on it is done). It sits there until
  their reporting manager (their supervising Employee, a Manager, or Admin —
  whoever already has access to that assignment) clicks the **Approve**
  button, the only action that actually promotes it to Completed — a green
  "Approve" button appears right on the assignments row, and also in the
  detail modal, whenever a row is Pending Approval. Enforced both in the UI
  (`requestsApproval`/`approveCompletion` in `js/dashboard.js`) and, more
  importantly, by the database (`2026-08-24_completion-approval.sql`
  redirects the write server-side too) — see Backend below.
- **Reports tab** — a live, filterable preview (My Tasks Only and Search
  first, then Status/Priority/Team, then an Updated From/To date range) with
  one **Export Excel** button that downloads exactly what's currently
  filtered, as `.xlsx` via SheetJS (`js/data.js` exportTasksToExcel), not
  CSV. The From/To pair filters by last-updated date — created, edited,
  status/progress changed, reassigned, anything that touches the row bumps
  it (`assignments.updated_at`, kept current by a DB trigger — see
  Backend below) — leave both blank for everything, or set From = To for
  a single day's report.
- **Collaboration** — assignment details now contain a discussion thread,
  append-only activity history, and secure file attachments (up to 10 MB).
  Files are stored in the private `assignment-files` Supabase Storage bucket;
  access follows the same assignment scope as the rest of the dashboard.
- **Notifications and reminders** — the header bell shows task assignment,
  update, comment, and due-date notices. Due reminders are generated when an
  assignee opens or refreshes the dashboard: overdue, due today, and due in
  the next three days. They are in-app reminders; sending email/push while no
  one has the app open requires a scheduled Edge Function or external provider.
- **Calendar and saved views** — the Calendar tab provides a month view of
  due dates. The Assignments tab also has quick views for this week's work,
  overdue tasks, approval queue, and urgent tasks.
- All data (users + teams + assignments + activity log + comments) lives
  in Postgres, protected by Row Level Security, matching the org chart at
  the top of this file: Intern/External only ever see what's assigned to
  them, an Employee only their own Interns/Externals (via `supervisor_id`),
  a Manager only the team(s) they lead (via `team_id`, matched against
  every team where `teams.manager_id` is them — one Manager can lead more
  than one team), Admin sees everything.

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
  `2026-08-16_manager-multi-team.sql` is the one that lets a Manager lead
  more than one team — run it before assigning a second team to a Manager
  who already leads one, otherwise the old single-team lookup used by RLS
  throws instead of scoping correctly.
  `2026-08-18_assignment-updated-at.sql` adds `assignments.updated_at`, kept
  current by a DB trigger on every update — run it before using the Reports
  tab's Updated From/To date filter, otherwise every row has a null
  updated_at and any date-filtered export comes back empty.
  `2026-08-24_completion-approval.sql` adds the DB trigger that redirects an
  Intern/External setting their own assignment to Completed into Pending
  Approval instead — run it so that rule holds even if someone bypasses the
  frontend (e.g. a direct API call), not just via the app's own redirect.
  `2026-08-24_assigned-by-visibility.sql` fixes the assignment detail
  modal's "Assigned By" showing blank for anyone who couldn't already see
  the assigner's profile under RLS (most commonly an Intern/External looking
  at a task their supervising Employee assigned them) — run it so that field
  reliably resolves to a name (or "Self Assigned" for your own tasks)
  instead of "—".
  `2026-08-28_collaboration-notifications-attachments.sql` creates the
  notifications and attachment metadata tables, their RLS policies, and the
  private Storage bucket required by the collaboration, reminder, and file
  features. Run it before deploying this version of the frontend.
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
