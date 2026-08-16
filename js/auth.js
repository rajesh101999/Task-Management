/* auth.js — authentication and team-member management, backed by Supabase
   (Postgres + Supabase Auth — see js/supabaseClient.js). Passwords are
   hashed and managed by Supabase, not stored in this app's own tables. */

function mapProfile(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    name: row.name,
    email: row.email,
    role: row.role,
    division: row.division,
    teamId: row.team_id,
    supervisorId: row.supervisor_id,
    avatarUrl: row.avatar_url,
  };
}

function mapTeam(row) {
  return {
    id: row.id,
    name: row.name,
    managerId: row.manager_id,
    createdAt: row.created_at,
  };
}

// ---------- Session ----------

async function getSession() {
  const { data: { session: authSession } } = await sb.auth.getSession();
  if (!authSession) return null;

  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', authSession.user.id)
    .single();
  if (error || !profile) return null;

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    division: profile.division,
    teamId: profile.team_id,
    supervisorId: profile.supervisor_id,
    avatarUrl: profile.avatar_url,
  };
}

async function login(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return { ok: false, error: 'Invalid email or password.' };
  }
  const session = await getSession();
  if (!session) {
    await sb.auth.signOut();
    return { ok: false, error: 'Your account is not active. Contact a Manager or Admin.' };
  }
  return { ok: true, session };
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// Call at the top of dashboard.html — bounces to login if not authenticated.
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

// Call at the top of index.html — skips straight to the dashboard if a
// session already exists.
async function redirectIfAuthed() {
  const session = await getSession();
  if (session) window.location.href = 'dashboard.html';
}

// ---------- Users / team ----------

async function getUsers() {
  const { data, error } = await sb.from('profiles').select('*').order('name');
  if (error) { console.error(error); return []; }
  return data.map(mapProfile);
}

async function getEmployees() {
  const users = await getUsers();
  return users.filter(u => u.role === 'Employee');
}

// Org chart, top to bottom: Admin > Manager (leads a Team) > Employee
// (member of a Team) > Intern/External (reports to one Employee, via
// supervisor_id). Each tier gets "manager-style" dashboard access — create/
// edit/delete assignments, manage People rows, see workload — scoped down
// to whoever reports to them (RLS enforces the actual scoping; this just
// says who gets the UI for it at all). Admin is a superset alongside
// Manager/Employee rather than a replacement for either.
function hasFullAccess(role) {
  return role === 'Manager' || role === 'Admin' || role === 'Employee';
}

// The bottom of the chart: Intern, External. Each can be assigned work and
// only ever sees their own assignments (enforced by RLS) — identical access
// to each other, just a different label for org-chart purposes. Named as
// the inverse of hasFullAccess so a future addition to either group can't
// quietly fall through the cracks between the two.
function isStaffRole(role) {
  return !hasFullAccess(role);
}

// Roles that do hands-on assignment work, regardless of whether they also
// supervise anyone: Employee, Intern, External (i.e. not Manager/Admin).
// Distinct from isStaffRole, which narrowed to just Intern/External once
// Employee gained hasFullAccess — this is for places that still mean "the
// whole front line" (e.g. a Team Workload panel), not "who lacks full
// access".
function isWorkerRole(role) {
  return role === 'Employee' || role === 'Intern' || role === 'External';
}

// Roles that carry a team_id (they belong to a Manager's Team).
const TEAM_ROLES = ['Employee', 'Intern', 'External'];

// Roles that carry a supervisor_id (they report to one specific Employee).
const SUPERVISED_ROLES = ['Intern', 'External'];

// Which roles each hasFullAccess tier is allowed to create/edit people
// into, from the Add/Edit Member modal. Mirrors the role checks baked into
// the profiles_insert/profiles_update RLS policies (supabase/migrations/
// 2026-08-12_employee-supervisors.sql) — this list is what the UI offers;
// the database is what actually enforces it.
const CREATABLE_ROLES = {
  Admin: ['Employee', 'Intern', 'External', 'Manager', 'Admin'],
  Manager: ['Employee', 'Intern', 'External'],
  Employee: ['Intern', 'External'],
};

const ID_PREFIXES = { Manager: 'MGR', Admin: 'ADM', Intern: 'INT', External: 'EXT' };

// Next free ID for a role — EMP0xx for Employees, MGR0xx for Managers,
// ADM0xx for Admins — based on the highest existing numeric suffix for that
// prefix. Pure/sync: callers supply the current user list (a fresh fetch, or
// a cache).
function getNextUserId(role, users) {
  const prefix = ID_PREFIXES[role] || 'EMP';
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const nums = users
    .map(u => re.exec(u.employeeId || ''))
    .filter(Boolean)
    .map(m => Number(m[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// ---------- Teams ----------
// Admin-only: group Employees under a Manager. A Manager's own row in
// `profiles` never gets a team_id (they aren't a "member" of a team, they
// lead one) — a Manager's team is found via teams.manager_id instead.

async function getTeams() {
  const { data, error } = await sb.from('teams').select('*').order('name');
  if (error) { console.error(error); return []; }
  return data.map(mapTeam);
}

async function createTeam({ name, managerId }) {
  const { data, error } = await sb.from('teams').insert({
    name: name.trim(),
    manager_id: managerId || null,
  }).select().single();
  if (error) { console.error(error); return { ok: false, error: error.message }; }
  return { ok: true, team: mapTeam(data) };
}

async function updateTeam(id, changes) {
  const dbChanges = {};
  if (changes.name !== undefined) dbChanges.name = changes.name.trim();
  if (changes.managerId !== undefined) dbChanges.manager_id = changes.managerId || null;

  const { data, error } = await sb.from('teams').update(dbChanges).eq('id', id).select().single();
  if (error) { console.error(error); return { ok: false, error: error.message }; }
  return { ok: true, team: mapTeam(data) };
}

// Members keep their profile (just lose the team_id, via ON DELETE SET NULL)
// — deleting a team never deletes people.
async function deleteTeam(id) {
  const { error } = await sb.from('teams').delete().eq('id', id);
  if (error) { console.error(error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Manager-initiated: create a Manager or Employee account directly from the
// dashboard. (There is no self-service sign-up — accounts are only created
// this way.) Signs the new account up on a second, memory-only Supabase
// client so the Manager's own browser session is never disturbed.
async function addTeamMember({ employeeId, name, email, password, role, division, teamId, supervisorId }) {
  const users = await getUsers();

  let id = (employeeId || '').trim();
  if (!id) {
    id = getNextUserId(role, users);
  } else if (users.some(u => (u.employeeId || '').toLowerCase() === id.toLowerCase())) {
    return { ok: false, error: 'That ID is already in use.' };
  }

  const tempClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
  });
  if (signUpError) {
    const msg = signUpError.message.toLowerCase();
    if (msg.includes('already registered') || msg.includes('already exists')) {
      return { ok: false, error: 'An account with that email already exists.' };
    }
    return { ok: false, error: signUpError.message };
  }
  if (!signUpData.user) {
    return { ok: false, error: 'Could not create the account — check the email/password and try again.' };
  }

  const profile = {
    id: signUpData.user.id,
    employee_id: id,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role,
    division: division.trim() || 'General',
    team_id: teamId || null,
    supervisor_id: supervisorId || null,
  };
  const { error: profileError } = await sb.from('profiles').insert(profile);
  if (profileError) {
    return { ok: false, error: `Account created but profile setup failed: ${profileError.message}` };
  }

  return { ok: true, user: mapProfile(profile) };
}

// Edit an existing user. `isSelf` must be true for the change to be allowed
// to touch email/password — Supabase Auth only lets an account change its
// own login credentials from client-side code (changing someone else's
// requires server-side admin access, which this app intentionally avoids).
async function updateUser(id, changes, isSelf) {
  if (changes.employeeId !== undefined) {
    const users = await getUsers();
    const clash = users.find(u => u.id !== id && (u.employeeId || '').toLowerCase() === changes.employeeId.toLowerCase());
    if (clash) return { ok: false, error: 'That Employee ID is already in use.' };
  }

  const profileChanges = {};
  if (changes.employeeId !== undefined) profileChanges.employee_id = changes.employeeId;
  if (changes.name !== undefined) profileChanges.name = changes.name;
  if (changes.division !== undefined) profileChanges.division = changes.division;
  if (changes.role !== undefined) profileChanges.role = changes.role;
  if (changes.teamId !== undefined) profileChanges.team_id = changes.teamId || null;
  if (changes.supervisorId !== undefined) profileChanges.supervisor_id = changes.supervisorId || null;
  if (changes.avatarUrl !== undefined) profileChanges.avatar_url = changes.avatarUrl || null;

  if (isSelf) {
    const authChanges = {};
    if (changes.email) authChanges.email = changes.email;
    if (changes.password) authChanges.password = changes.password;
    if (Object.keys(authChanges).length) {
      const { error } = await sb.auth.updateUser(authChanges);
      if (error) return { ok: false, error: error.message };
    }
    if (changes.email) profileChanges.email = changes.email.trim().toLowerCase();
  }

  if (Object.keys(profileChanges).length) {
    const { error } = await sb.from('profiles').update(profileChanges).eq('id', id);
    if (error) return { ok: false, error: error.message };
  }

  const { data: updated, error: fetchError } = await sb.from('profiles').select('*').eq('id', id).single();
  if (fetchError || !updated) return { ok: false, error: 'Saved, but could not reload the updated record.' };
  return { ok: true, user: mapProfile(updated) };
}

// Sets a new password for someone else's account. Supabase Auth only lets
// an account change its own password from browser code, so this calls the
// `reset-password` Edge Function (service_role key, server-side only) —
// see supabase/functions/reset-password/index.ts. That function re-checks
// permissions itself; nothing here is trusted on its own.
async function resetPassword(userId, newPassword) {
  const { data, error } = await sb.functions.invoke('reset-password', {
    body: { userId, newPassword },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch { /* fall back to error.message */ }
    return { ok: false, error: message };
  }
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true };
}

// Removes the member's profile (and with it, their access to the app — the
// underlying Supabase Auth login is left in place since deleting it needs
// admin access this app doesn't use; it can be removed manually from the
// Supabase dashboard under Authentication > Users if a full purge is needed).
async function deleteUser(id, currentSessionId) {
  if (id === currentSessionId) {
    return { ok: false, error: "You can't delete the account you're currently signed in as." };
  }
  const { error } = await sb.from('profiles').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
