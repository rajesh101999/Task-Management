/* auth.js — demo authentication (client-side only)
   NOTE: Users/passwords live in the browser's localStorage. This is fine for a
   local demo/prototype, but it is NOT secure — anyone with access to the
   browser can read them. Swap this module for a real backend before using
   this with real people or real data. */

const USERS_KEY = 'atd_users';
const SESSION_KEY = 'atd_session';

function seedUsers() {
  if (localStorage.getItem(USERS_KEY)) return;
  const seed = [
    { id: 1, employeeId: 'MGR001', name: 'Rajesh',   email: 'manager@demo.com',  password: 'manager123',  role: 'Manager',  division: 'CDA' },
    { id: 2, employeeId: 'EMP001', name: 'Pavithra', email: 'employee@demo.com', password: 'employee123', role: 'Employee', division: 'CDA' },
  ];
  localStorage.setItem(USERS_KEY, JSON.stringify(seed));
}

function getUsers() {
  seedUsers();
  return JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getEmployees() {
  return getUsers().filter(u => u.role === 'Employee');
}

function findUserByEmail(email) {
  return getUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
}

function findUserById(id) {
  return getUsers().find(u => u.id === id);
}

// Next free ID for a role — EMP0xx for Employees, MGR0xx for Managers —
// based on the highest existing numeric suffix for that prefix.
function getNextUserId(role) {
  const prefix = role === 'Manager' ? 'MGR' : 'EMP';
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const nums = getUsers()
    .map(u => re.exec(u.employeeId || ''))
    .filter(Boolean)
    .map(m => Number(m[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// Manager-initiated: create a Manager or Employee account directly from the dashboard.
// (There is no self-service sign-up — accounts are only created this way.)
function addTeamMember({ employeeId, name, email, password, role, division }) {
  const users = getUsers();
  if (findUserByEmail(email)) {
    return { ok: false, error: 'An account with that email already exists.' };
  }
  const id = (employeeId || '').trim() || getNextUserId(role);
  if (users.some(u => (u.employeeId || '').toLowerCase() === id.toLowerCase())) {
    return { ok: false, error: 'That ID is already in use.' };
  }
  const user = {
    id: Date.now(),
    employeeId: id,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
    role,
    division: division.trim() || 'General',
  };
  users.push(user);
  saveUsers(users);
  return { ok: true, user };
}

// Edit an existing user. Pass password: '' to leave the current one unchanged.
function updateUser(id, changes) {
  const users = getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return { ok: false, error: 'User not found.' };

  if (changes.email) {
    const clash = users.find(u => u.id !== id && u.email.toLowerCase() === changes.email.toLowerCase());
    if (clash) return { ok: false, error: 'Another account already uses that email.' };
  }
  if (changes.employeeId) {
    const clash = users.find(u => u.id !== id && (u.employeeId || '').toLowerCase() === changes.employeeId.toLowerCase());
    if (clash) return { ok: false, error: 'That Employee ID is already in use.' };
  }
  if (!changes.password) delete changes.password;

  users[idx] = { ...users[idx], ...changes };
  saveUsers(users);

  // Keep an active session's own record in sync (e.g. a manager editing themselves).
  const session = getSession();
  if (session && session.id === id) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, ...changes, password: undefined }));
  }
  return { ok: true, user: users[idx] };
}

function deleteUser(id) {
  const session = getSession();
  if (session && session.id === id) {
    return { ok: false, error: "You can't delete the account you're currently signed in as." };
  }
  saveUsers(getUsers().filter(u => u.id !== id));
  return { ok: true };
}

function login(email, password) {
  const user = findUserByEmail(email);
  if (!user || user.password !== password) {
    return { ok: false, error: 'Invalid email or password.' };
  }
  const session = { id: user.id, name: user.name, email: user.email, role: user.role, division: user.division };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true, session };
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.location.href = 'index.html';
}

function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Call at the top of dashboard.html — bounces to login if not authenticated.
function requireAuth() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

// Call at the top of index.html — skips straight to the dashboard if a
// session already exists.
function redirectIfAuthed() {
  if (getSession()) window.location.href = 'dashboard.html';
}
