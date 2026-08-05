# Assignment Tracker Dashboard

A small, self-contained assignment tracker with email/password login and two
roles: **Manager** and **Employee**. No build step, no server, no
dependencies — just static HTML/CSS/JS.

## Run it

Open `index.html` directly in a browser, or serve the folder locally:

```
npx serve .
```

## First login

There's no self-service sign-up — accounts are created by a Manager from the
**Team** tab (see below). To get in the very first time, use the seed
account below, then add everyone else from the dashboard:

| Role     | Email               | Password     |
|----------|---------------------|---------------|
| Manager  | manager@demo.com    | manager123    |
| Employee | employee@demo.com   | employee123   |

(These aren't shown on the sign-in page itself — keep this list somewhere
your team can find it, or change the password after the first login.)

## What's included

- **Auth** (`js/auth.js`) — sign in / log out, session kept in
  `localStorage`. No public sign-up page — `signup.html` is just a redirect
  stub kept around in case of old links/bookmarks.
- **Manager view** — create, edit, delete assignments; assign to any
  registered employee; see every assignment, workload, and activity feed.
- **Team tab (Manager only)** — add, edit, or remove Manager and Employee
  accounts (name, ID, email, division, password) directly from the
  dashboard. A manager can edit their own details too, except their own
  role, and can't delete the account they're currently signed in as.
- **Employee view** — see only assignments assigned to them; update status
  and progress; add comments.
- **Dashboard KPIs** — Total, Pending, In Progress, Completed, Overdue.
- **Status workflow** — Pending → Accepted → In Progress → Under Review →
  Completed, plus On Hold / Blocked / Cancelled.
- **CSV export** of the currently filtered table.
- All data (users + assignments + activity log + comments) lives in the
  browser's `localStorage` — nothing leaves the machine, and clearing site
  data resets the demo.

## ⚠️ Security note

This is a **client-side demo**. Passwords are stored in plain text in
`localStorage` so anyone with access to the browser (devtools, extensions)
can read them. That's fine for trying out the workflow locally, but **do not
use this as-is for real users or real data** — swap `js/auth.js` for a real
backend with hashed passwords and server-side sessions before deploying it
for actual use.

## File structure

```
index.html        Sign-in page
signup.html        Redirect stub (old sign-up page, retired)
dashboard.html      Role-aware dashboard (Manager / Employee), incl. Team tab
css/style.css        All styling
js/auth.js         Users, sessions, login/logout, account CRUD
js/data.js         Assignments + activity log storage and CRUD
js/dashboard.js      Dashboard rendering and UI wiring
```
