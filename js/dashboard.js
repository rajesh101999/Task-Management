/* dashboard.js — renders the role-aware dashboard and wires up all UI actions.
   Users/tasks/activity are fetched from Supabase once per refresh and cached
   in the module-level variables below; renders read from that cache so
   filtering/searching stays instant (no network round-trip per keystroke). */

let session = null;
let allUsers = [];
let allTasks = [];
let allTeams = [];
let myTeamIds = []; // every team this Manager leads, if any (Admin/Employee: unused)
let activeTaskId = null;
// undefined = no avatar change staged; '' = explicit "remove photo"; a data
// URL = a new photo picked in the Settings modal, not yet saved.
let pendingAvatarDataUrl;

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  session = await requireAuth();
  if (!session) return; // requireAuth already redirected to index.html

  document.getElementById('userName').textContent = session.name;
  document.getElementById('userEmail').textContent = session.email;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  applyAvatar(session.avatarUrl);
  setupHeaderMenu();
  setupThemeMenu();
  setupSettingsModal();

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  if (hasFullAccess(session.role)) {
    document.getElementById('newTaskBtn').style.display = 'inline-flex';
    document.getElementById('tableTitle').textContent = 'All Assignments';
    document.getElementById('teamNavItem').style.display = 'flex';
    // Intern/External only ever see their own tasks anyway; everyone with
    // full access sees a wider set (their reports'/team's/everyone's), so
    // this toggle is what gets them back to just "my tasks".
    document.getElementById('myTasksWrap').style.display = 'flex';
    document.getElementById('reportMyTasksWrap').style.display = 'flex';
    document.getElementById('newEmployeeBtn').addEventListener('click', () => openEmployeeModal());
    document.getElementById('employeeForm').addEventListener('submit', onSaveEmployee);
    document.getElementById('employeeSearch').addEventListener('input', renderEmployees);
    document.getElementById('resetPasswordForm').addEventListener('submit', onResetPassword);
    document.querySelectorAll('input[name="e_role"]').forEach(r => {
      r.addEventListener('change', () => {
        updateEmployeeIdPlaceholder();
        updateHierarchyFieldsVisibility();
      });
    });
    // Only Admin ever changes this field interactively (Manager/Employee
    // have it pinned/hidden), but the listener is harmless either way.
    document.getElementById('e_team').addEventListener('change', () => refreshSupervisorOptions());
  } else {
    document.getElementById('tableTitle').textContent = 'My Assignments';
    document.getElementById('workloadPanel').style.display = 'none';
    document.getElementById('newTaskBtn').textContent = '+ Add My Task';
    document.getElementById('newTaskBtn').style.display = 'inline-flex';
  }

  // Teams (grouping Employees under a Manager who's then scoped to just
  // that team) is an Admin-only capability — Managers manage members
  // through the People tab, which RLS already scopes to their own team.
  if (session.role === 'Admin') {
    document.getElementById('teamsNavItem').style.display = 'flex';
    document.getElementById('newTeamBtn').addEventListener('click', () => openTeamModal());
    document.getElementById('teamForm').addEventListener('submit', onSaveTeam);
  }

  // Team filter: only useful to someone who can see more than one team's
  // worth of people at once — Admin (every team) or a Manager leading more
  // than one team. Options are filled once allTeams/myTeamIds are loaded,
  // below.
  if (session.role === 'Admin' || session.role === 'Manager') {
    document.getElementById('filterTeam').style.display = 'inline-block';
    document.getElementById('reportFilterTeam').style.display = 'inline-block';
  }

  fillOptions(document.getElementById('filterStatus'), STATUSES, true);
  fillOptions(document.getElementById('filterPriority'), PRIORITIES, true);
  fillOptions(document.getElementById('reportFilterStatus'), STATUSES, true);
  fillOptions(document.getElementById('reportFilterPriority'), PRIORITIES, true);
  fillOptions(document.getElementById('f_priority'), PRIORITIES, false);
  fillOptions(document.getElementById('f_status'), STATUSES, false);
  fillOptions(document.getElementById('detailStatus'), STATUSES, false);

  document.getElementById('filterStatus').addEventListener('change', renderAll);
  document.getElementById('filterPriority').addEventListener('change', renderAll);
  document.getElementById('filterTeam').addEventListener('change', renderAll);
  document.getElementById('filterMine').addEventListener('change', renderAll);
  document.getElementById('filterSearch').addEventListener('input', renderAll);
  document.getElementById('reportFilterStatus').addEventListener('change', renderReportTable);
  document.getElementById('reportFilterPriority').addEventListener('change', renderReportTable);
  document.getElementById('reportFilterTeam').addEventListener('change', renderReportTable);
  document.getElementById('reportFilterMine').addEventListener('change', renderReportTable);
  document.getElementById('reportFilterSearch').addEventListener('input', renderReportTable);
  document.getElementById('reportFilterFromDate').addEventListener('change', renderReportTable);
  document.getElementById('reportFilterToDate').addEventListener('change', renderReportTable);
  document.getElementById('reportExportBtn').addEventListener('click', onExport);
  document.getElementById('newTaskBtn').addEventListener('click', () => openTaskModal());
  document.getElementById('taskForm').addEventListener('submit', onSaveTask);
  document.getElementById('saveStatusBtn').addEventListener('click', onSaveStatus);
  document.getElementById('approveBtn').addEventListener('click', () => approveCompletion(activeTaskId));
  document.getElementById('detailProgress').addEventListener('input', (e) => {
    document.getElementById('progressValue').textContent = `${e.target.value}%`;
    e.target.style.setProperty('--pct', `${e.target.value}%`);
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Clicking the dimmed backdrop (anywhere outside the modal card itself)
  // closes it, same as the × button. e.target is only the backdrop element
  // when the click didn't land on a descendant (the .modal card), so this
  // never fires for clicks inside the form.
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  await refreshData();
  fillEmployeeOptions();
  fillTeamFilterOptions();
  renderAll();
}

// Avatar opens/closes the profile dropdown (name, email, logout); the
// fullscreen icon is wired up too. The theme switcher has its own menu —
// see setupThemeMenu(). Notifications is still just a visual placeholder —
// no notification feed exists yet.
function setupHeaderMenu() {
  const profileBtn = document.getElementById('profileBtn');
  const profileDropdown = document.getElementById('profileDropdown');

  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = profileDropdown.classList.toggle('open');
    profileBtn.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (e) => {
    if (!profileDropdown.contains(e.target) && e.target !== profileBtn) {
      profileDropdown.classList.remove('open');
      profileBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    profileDropdown.classList.remove('open');
    profileBtn.setAttribute('aria-expanded', 'false');
    openSettingsModal();
  });

  document.getElementById('fullscreenBtn').addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
}

// Light / Dark / System theme switcher. "System" is stored as the absence
// of a saved choice (and no data-theme attribute) rather than a literal
// value — css/style.css's prefers-color-scheme media query is what actually
// renders it, so there's nothing for this to apply beyond clearing any
// earlier explicit choice. The <head> of every page applies a saved
// Light/Dark choice inline, before the stylesheet loads, so there's no
// flash of the wrong theme on load — this only needs to handle changes made
// while the page is already open.
const THEME_STORAGE_KEY = 'theme';

function getStoredTheme() {
  const t = localStorage.getItem(THEME_STORAGE_KEY);
  return (t === 'light' || t === 'dark') ? t : 'system';
}

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') {
    document.documentElement.setAttribute('data-theme', choice);
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_STORAGE_KEY);
  }
  updateThemeUI();
}

// Syncs the header's theme icon (shows whichever of the three was picked,
// not the resolved light/dark appearance — same idea as GitHub's own
// theme switcher) and the checkmark in the dropdown.
function updateThemeUI() {
  const choice = getStoredTheme();
  document.getElementById('themeIconLight').style.display = choice === 'light' ? 'block' : 'none';
  document.getElementById('themeIconDark').style.display = choice === 'dark' ? 'block' : 'none';
  document.getElementById('themeIconSystem').style.display = choice === 'system' ? 'block' : 'none';
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeChoice === choice);
  });
}

function setupThemeMenu() {
  const themeBtn = document.getElementById('themeBtn');
  const themeDropdown = document.getElementById('themeDropdown');

  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = themeDropdown.classList.toggle('open');
    themeBtn.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (e) => {
    if (!themeDropdown.contains(e.target) && e.target !== themeBtn) {
      themeDropdown.classList.remove('open');
      themeBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.themeChoice);
      themeDropdown.classList.remove('open');
      themeBtn.setAttribute('aria-expanded', 'false');
    });
  });

  updateThemeUI();
}

// Reflects a profile picture (or its absence) everywhere the header shows
// one: the small header avatar button and the large one in its dropdown.
// Each spot is an <img> (shown when there's a url) layered over the generic
// person <svg> (shown otherwise) — see dashboard.html.
function applyAvatar(url) {
  [['profileAvatarImg', 'profileAvatarIcon'], ['dropdownAvatarImg', 'dropdownAvatarIcon']]
    .forEach(([imgId, iconId]) => setAvatarPreview(imgId, iconId, url));
}

function setAvatarPreview(imgId, iconId, url) {
  const img = document.getElementById(imgId);
  const icon = document.getElementById(iconId);
  if (!img || !icon) return;
  if (url) {
    img.src = url;
    img.style.display = 'block';
    icon.style.display = 'none';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    icon.style.display = 'block';
  }
}

// My Settings modal: change my own profile photo and/or password. Reuses
// the same self-service password path the People-tab "Edit" modal already
// has (updateUser(..., isSelf: true) -> sb.auth.updateUser) rather than the
// admin-only reset-password Edge Function, which only ever targets other
// people's accounts.
function setupSettingsModal() {
  document.getElementById('settingsForm').addEventListener('submit', onSaveSettings);

  document.getElementById('changePhotoBtn').addEventListener('click', () => {
    document.getElementById('settingsAvatarInput').click();
  });

  document.getElementById('settingsAvatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file.');
      e.target.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast('That image is too large (max 8MB).');
      e.target.value = '';
      return;
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      pendingAvatarDataUrl = dataUrl;
      setAvatarPreview('settingsAvatarImg', 'settingsAvatarIcon', dataUrl);
    } catch (err) {
      showToast(err.message || 'Could not process that image.');
    }
  });

  document.getElementById('removePhotoBtn').addEventListener('click', () => {
    pendingAvatarDataUrl = '';
    document.getElementById('settingsAvatarInput').value = '';
    setAvatarPreview('settingsAvatarImg', 'settingsAvatarIcon', '');
  });
}

function openSettingsModal() {
  pendingAvatarDataUrl = undefined;
  document.getElementById('settingsAvatarInput').value = '';
  document.getElementById('settingsNewPassword').value = '';
  document.getElementById('settingsConfirmPassword').value = '';
  setAvatarPreview('settingsAvatarImg', 'settingsAvatarIcon', session.avatarUrl);
  openModal('settingsModalBackdrop');
}

async function onSaveSettings(e) {
  e.preventDefault();
  const changes = {};
  if (pendingAvatarDataUrl !== undefined) changes.avatarUrl = pendingAvatarDataUrl;

  const newPw = document.getElementById('settingsNewPassword').value;
  const confirmPw = document.getElementById('settingsConfirmPassword').value;
  if (newPw || confirmPw) {
    if (newPw.length < 6) {
      showToast('New password must be at least 6 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      showToast('Passwords do not match.');
      return;
    }
    changes.password = newPw;
  }

  if (!Object.keys(changes).length) {
    showToast('Nothing to update.');
    return;
  }

  const result = await updateUser(session.id, changes, true);
  if (!result.ok) {
    showToast(result.error || 'Could not update settings.');
    return;
  }

  session.avatarUrl = result.user.avatarUrl;
  applyAvatar(session.avatarUrl);
  pendingAvatarDataUrl = undefined;
  closeModal('settingsModalBackdrop');
  showToast('Settings updated.');
}

// Downscales/compresses an image file client-side before it's stored as a
// data URL on profiles.avatar_url (see supabase/migrations/2026-08-16_
// profile-avatar.sql) — keeps rows small without needing a Storage bucket.
function resizeImageToDataUrl(file, maxSize = 256, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) { height = Math.round(height * (maxSize / width)); width = maxSize; }
        } else if (height > maxSize) {
          width = Math.round(width * (maxSize / height));
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function fillOptions(select, values, includeAll) {
  select.innerHTML = includeAll ? select.innerHTML : '';
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

// An Intern/External can still pick "Completed" for their own assignment —
// it's just not what actually lands in the database. onSaveTask/onSaveStatus
// redirect that choice to "Pending Approval" instead (see requestsApproval
// below), and the DB trigger in 2026-08-24_completion-approval.sql backs
// that up server-side. True only when it's *their own* assignment
// (assignedTo === them) and it isn't already Completed — the latter check
// matters because without it, simply reopening an already-approved task and
// hitting Update/Save with no changes would demote it straight back to
// Pending Approval.
function requestsApproval(status, assignedTo, currentStatus) {
  return status === 'Completed' && currentStatus !== 'Completed'
    && isStaffRole(session.role) && assignedTo === session.id;
}

function assigneeOption(user) {
  const opt = document.createElement('option');
  opt.value = user.id;
  opt.textContent = `${user.name} (${user.division})`;
  return opt;
}

function appendOptionGroup(select, label, users) {
  if (!users.length) return;
  const group = document.createElement('optgroup');
  group.label = label;
  users.forEach(u => group.appendChild(assigneeOption(u)));
  select.appendChild(group);
}

// Each hasFullAccess tier can only hand work to whoever reports to them
// (allUsers is already scoped that way by RLS): a Manager to their team's
// Employees/Interns/Externals, an Employee to just their own Interns/
// Externals, an Admin to anyone. Each role gets its own group in the
// dropdown so they're easy to tell apart at a glance.
function fillEmployeeOptions() {
  const select = document.getElementById('f_assignedTo');
  select.innerHTML = '';

  if (session.role === 'Admin') {
    appendOptionGroup(select, 'Managers', allUsers.filter(u => u.role === 'Manager'));
  }
  // Employees group only makes sense for the tiers that supervise Employees
  // (Manager/Admin) — showing it to an Employee session would just repeat
  // their own row (already added as "Me" below) under a confusing label.
  if (session.role === 'Admin' || session.role === 'Manager') {
    appendOptionGroup(select, 'Employees', allUsers.filter(u => u.role === 'Employee'));
  }
  appendOptionGroup(select, 'Interns', allUsers.filter(u => u.role === 'Intern'));
  appendOptionGroup(select, 'External', allUsers.filter(u => u.role === 'External'));

  // None of the groups above include the signed-in person themselves (an
  // Employee isn't in the "Employees" group they see, a Manager isn't an
  // Employee, Admin is in none of them), so they could never assign work to
  // their own name. Add "Me" up front so they can create a task for
  // themselves too.
  if (hasFullAccess(session.role)) {
    const me = allUsers.find(u => u.id === session.id);
    if (me) {
      const opt = assigneeOption(me);
      opt.textContent = `${me.name} (Me)`;
      select.insertBefore(opt, select.firstChild);
    }
  }
}

// Populates the Team filter on both the Assignments and Reports tabs —
// Admin gets every team, a Manager gets just the team(s) they lead (see
// boot(), which only shows the filter at all for those two roles). Keeps
// whatever's currently selected if it's still a valid option, same as
// refreshSupervisorOptions' preserveId behavior — so re-filling the list
// after a team is added/edited/deleted doesn't reset an in-progress filter.
function fillTeamFilterOptions() {
  const teams = session.role === 'Admin' ? allTeams : allTeams.filter(t => myTeamIds.includes(t.id));
  const optionsHtml = '<option value="">All Teams</option>' +
    teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  ['filterTeam', 'reportFilterTeam'].forEach(id => {
    const select = document.getElementById(id);
    const current = select.value;
    select.innerHTML = optionsHtml;
    if (teams.some(t => t.id === current)) select.value = current;
  });
}

/* ---------- Fetch + cache ---------- */

async function refreshData() {
  [allUsers, allTasks, allTeams] = await Promise.all([getUsers(), getTasks(), getTeams()]);
  myTeamIds = allTeams.filter(t => t.managerId === session.id).map(t => t.id);
}

async function refreshAndRender() {
  await refreshData();
  renderAll();
}

/* ---------- Data scoping ---------- */

// Row Level Security already scopes `assignments` server-side (Admin sees
// all, a Manager only their own team's, Employees only what's assigned to
// them), so allTasks is already the right set — no client-side role
// filtering needed here.
function visibleTasks() {
  return allTasks;
}

// fromDate/toDate are optional — only the Reports tab has those controls
// (see filteredReportTasks), the Assignments tab just never passes them, so
// isUpdatedInRange's own no-bound check ('' / undefined on both sides)
// makes them a no-op there.
function filterTasksList(status, priority, teamId, mineOnly, search, fromDate, toDate) {
  return visibleTasks().filter(t => {
    if (status && t.status !== status) return false;
    if (priority && t.priority !== priority) return false;
    if (teamId && ownerTeamId(t.assignedTo, allUsers) !== teamId) return false;
    if (mineOnly && t.assignedTo !== session.id) return false;
    if (search && !`${t.title} ${t.division} ${ownerName(t.assignedTo, allUsers)}`.toLowerCase().includes(search)) return false;
    if (!isUpdatedInRange(t, fromDate, toDate)) return false;
    return true;
  });
}

function filteredTasks() {
  const status = document.getElementById('filterStatus').value;
  const priority = document.getElementById('filterPriority').value;
  const teamId = document.getElementById('filterTeam').value;
  const search = document.getElementById('filterSearch').value.trim().toLowerCase();
  const mineOnly = hasFullAccess(session.role) && document.getElementById('filterMine').checked;
  return filterTasksList(status, priority, teamId, mineOnly, search);
}

// Mirrors filteredTasks() but reads the Reports tab's own filter controls —
// Reports has no live table, so its filters are independent of the
// Assignments tab's (changing one shouldn't silently change the other).
// The From/To date pair is Reports-only — it's what replaced the old fixed
// "Download Today's Report" button: leave both blank for everything (same
// as every other filter here), or set From = To for what used to be
// "today", or any wider range for a custom-dated report.
function filteredReportTasks() {
  const status = document.getElementById('reportFilterStatus').value;
  const priority = document.getElementById('reportFilterPriority').value;
  const teamId = document.getElementById('reportFilterTeam').value;
  const search = document.getElementById('reportFilterSearch').value.trim().toLowerCase();
  const mineOnly = hasFullAccess(session.role) && document.getElementById('reportFilterMine').checked;
  const fromDate = document.getElementById('reportFilterFromDate').value;
  const toDate = document.getElementById('reportFilterToDate').value;
  return filterTasksList(status, priority, teamId, mineOnly, search, fromDate, toDate);
}

/* ---------- Render ---------- */

function renderAll() {
  renderKPIs();
  renderTable();
  renderReportTable();
  if (hasFullAccess(session.role)) {
    renderWorkload();
    renderEmployees();
  }
  if (session.role === 'Admin') {
    renderTeams();
  }
  renderHeaderTeam();
}

// Small always-visible badge in the header showing which team(s) the
// signed-in person is scoped to: every team a Manager leads (there can be
// more than one), or the single team their own role (Employee/Intern/
// External) belongs to. Admin isn't scoped to a single team, so nothing
// shows for them.
function renderHeaderTeam() {
  const badge = document.getElementById('headerTeamBadge');
  let names = [];
  if (session.role === 'Manager') {
    names = myTeamIds.map(teamName);
  } else if (TEAM_ROLES.includes(session.role)) {
    names = session.teamId ? [teamName(session.teamId)] : [];
  }
  // More than a couple of team names would overrun the header, so past that
  // point show a count instead — the full list is still there on hover.
  badge.textContent = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');
  badge.title = names.join(', ');
  badge.style.display = names.length ? 'inline-block' : 'none';
}

/* ---------- Tabs ---------- */

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.getElementById('assignmentsView').style.display = tabId === 'assignmentsView' ? 'block' : 'none';
  document.getElementById('employeesView').style.display = tabId === 'employeesView' ? 'block' : 'none';
  document.getElementById('reportsView').style.display = tabId === 'reportsView' ? 'block' : 'none';
  document.getElementById('teamsView').style.display = tabId === 'teamsView' ? 'block' : 'none';
}

const KPI_ICONS = {
  total: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/></svg>',
  pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  completed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  overdue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

function renderKPIs() {
  const tasks = visibleTasks();
  const total = tasks.length;
  const pending = tasks.filter(t => t.status === 'Pending').length;
  const inProgress = tasks.filter(t => t.status === 'In Progress' || t.status === 'Accepted').length;
  const completed = tasks.filter(t => t.status === 'Completed').length;
  const overdue = tasks.filter(isOverdue).length;

  const cards = [
    ['accent-total', total, 'Total Tasks', KPI_ICONS.total],
    ['accent-pending', pending, 'Pending', KPI_ICONS.pending],
    ['accent-progress', inProgress, 'In Progress', KPI_ICONS.progress],
    ['accent-completed', completed, 'Completed', KPI_ICONS.completed],
    ['accent-overdue', overdue, 'Overdue', KPI_ICONS.overdue],
  ];

  document.getElementById('kpiGrid').innerHTML = cards.map(([cls, val, label, icon]) => `
    <div class="kpi-card ${cls}">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-value">${val}</div>
      <div class="kpi-label">${label}</div>
    </div>
  `).join('');
}

function statusClass(status) {
  return 'pill-' + status.replace(/\s+/g, '');
}

function renderTable() {
  const tasks = filteredTasks().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const tbody = document.getElementById('taskTableBody');
  const empty = document.getElementById('emptyState');

  if (!tasks.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = tasks.map(t => {
    const overdue = isOverdue(t);
    // Intern/External can create tasks for themselves (t.assignedBy ===
    // them); those get the same Edit as anyone with full access gets. Work
    // assigned to them by someone else only ever gets "Update" (status/
    // progress via the detail modal). Assignments are never deletable once
    // created, by design — there's no Delete action anywhere in this table.
    const isOwnTask = !hasFullAccess(session.role) && t.assignedBy === session.id;
    // Whoever can already act on this row gets a one-click Approve the
    // moment its owner has requested completion — no need to open the
    // detail modal just to sign off. Only ever shown to a hasFullAccess
    // viewer since an Intern/External can never approve their own work.
    const approveAction = (hasFullAccess(session.role) && t.status === 'Pending Approval')
      ? `<button class="icon-btn icon-btn-approve" onclick="approveCompletion(${t.id})">Approve</button>` : '';
    let actions;
    if (hasFullAccess(session.role)) {
      actions = `<button class="icon-btn" onclick="openDetailModal(${t.id})">Update</button>
         <button class="icon-btn" onclick="openTaskModal(${t.id})">Edit</button>${approveAction}`;
    } else if (isOwnTask) {
      actions = `<button class="icon-btn" onclick="openDetailModal(${t.id})">Update</button>
         <button class="icon-btn" onclick="openTaskModal(${t.id})">Edit</button>`;
    } else {
      actions = `<button class="icon-btn" onclick="openDetailModal(${t.id})">Update</button>`;
    }

    return `
      <tr>
        <td>${escapeHtml(t.division)}</td>
        <td>${escapeHtml(t.title)}</td>
        <td>${escapeHtml(ownerName(t.assignedTo, allUsers))}</td>
        <td><span class="pill ${statusClass(t.status)}">${t.status}</span></td>
        <td><span class="pill ${statusClass(t.priority)}">${t.priority}</span></td>
        <td>${escapeHtml(t.estimatedTime || '—')}</td>
        <td>${formatDate(t.startDate)}</td>
        <td class="${overdue ? 'overdue-text' : ''}">${formatDate(t.dueDate)}${overdue ? ' ⚠' : ''}</td>
        <td>${t.progress}%</td>
        <td><div class="row-actions">${actions}</div></td>
      </tr>
    `;
  }).join('');
}

// Read-only preview of whatever the Reports filters currently match — same
// row shape as the Assignments table (minus Actions, since nothing here is
// editable) so what's on screen is exactly what Export Excel will write out.
function renderReportTable() {
  const tasks = filteredReportTasks().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const tbody = document.getElementById('reportTableBody');
  const empty = document.getElementById('reportEmptyState');
  if (!tbody) return;

  if (!tasks.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = tasks.map(t => {
    const overdue = isOverdue(t);
    return `
      <tr>
        <td>${escapeHtml(t.division)}</td>
        <td>${escapeHtml(t.title)}</td>
        <td>${escapeHtml(ownerName(t.assignedTo, allUsers))}</td>
        <td><span class="pill ${statusClass(t.status)}">${t.status}</span></td>
        <td><span class="pill ${statusClass(t.priority)}">${t.priority}</span></td>
        <td>${escapeHtml(t.estimatedTime || '—')}</td>
        <td>${formatDate(t.startDate)}</td>
        <td class="${overdue ? 'overdue-text' : ''}">${formatDate(t.dueDate)}${overdue ? ' ⚠' : ''}</td>
        <td>${t.progress}%</td>
      </tr>
    `;
  }).join('');
}

function renderWorkload() {
  // isWorkerRole (not isStaffRole) because a Manager's panel should still
  // include their Employees, and excluding session.id keeps an Employee's
  // own panel from listing themselves alongside their Interns/Externals —
  // isStaffRole alone used to be enough for this (Employee wasn't a
  // possible viewer), but now that Employee has hasFullAccess it isn't.
  const employees = allUsers.filter(u => isWorkerRole(u.role) && u.id !== session.id);
  const body = document.getElementById('workloadBody');

  if (!employees.length) {
    body.innerHTML = '<div class="empty-state">No team members yet.</div>';
    return;
  }

  body.innerHTML = employees.map(emp => {
    const count = allTasks.filter(t => t.assignedTo === emp.id && !['Completed', 'Cancelled'].includes(t.status)).length;
    return `<div class="workload-item"><span>${escapeHtml(emp.name)}</span><strong>${count} active</strong></div>`;
  }).join('');
}

// Active-work count shown per row: what an Intern/External is doing, or
// what anyone with full access (Employee/Manager/Admin) currently has open
// (assignments they created that aren't wrapped up yet).
function activeCountFor(user, tasks) {
  return hasFullAccess(user.role)
    ? tasks.filter(t => t.assignedBy === user.id && !['Completed', 'Cancelled'].includes(t.status)).length
    : tasks.filter(t => t.assignedTo === user.id && !['Completed', 'Cancelled'].includes(t.status)).length;
}

function renderEmployees() {
  const tbody = document.getElementById('employeeTableBody');
  const empty = document.getElementById('employeeEmptyState');
  if (!tbody) return;

  const search = (document.getElementById('employeeSearch')?.value || '').trim().toLowerCase();
  const members = allUsers.filter(u =>
    !search || `${u.name} ${u.email} ${u.employeeId} ${u.division} ${u.role}`.toLowerCase().includes(search)
  );

  if (!members.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = members.map(member => {
    const isSelf = member.id === session.id;
    return `
      <tr>
        <td>${escapeHtml(member.employeeId || '—')}</td>
        <td>${escapeHtml(member.name)}${isSelf ? ' <span style="color:var(--text-muted);font-size:11px;">(you)</span>' : ''}</td>
        <td>${escapeHtml(member.email)}</td>
        <td><span class="pill pill-role-${member.role}">${member.role}</span></td>
        <td>${escapeHtml(member.division)}</td>
        <td>${escapeHtml(teamName(member.teamId))}</td>
        <td>${escapeHtml(ownerName(member.supervisorId, allUsers))}</td>
        <td>${activeCountFor(member, allTasks)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" onclick="openEmployeeModal('${member.id}')">Edit</button>
            <button class="icon-btn" onclick="openResetPasswordModal('${member.id}')" ${isSelf ? 'disabled title="Change your own password from Edit instead"' : ''}>Reset Password</button>
            <button class="icon-btn" onclick="onDeleteEmployee('${member.id}')" ${isSelf ? 'disabled title="You can\'t delete your own account"' : ''}>Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // A Manager with no team yet would have their new hire vanish from their
  // own view (RLS scopes them to team_id in one of their teams, and a brand
  // new member can't join a team that doesn't exist) — block that instead
  // of letting it happen silently.
  const addBtn = document.getElementById('newEmployeeBtn');
  if (session.role === 'Manager' && !myTeamIds.length) {
    addBtn.disabled = true;
    addBtn.title = 'Ask an Admin to create your team first (Teams tab).';
  } else {
    addBtn.disabled = false;
    addBtn.title = '';
  }
}

function openEmployeeModal(id) {
  const form = document.getElementById('employeeForm');
  form.reset();
  document.getElementById('e_id').value = '';
  document.getElementById('e_password').required = true;
  document.getElementById('e_email').disabled = false;
  document.getElementById('e_password').disabled = false;

  // Only offer the roles this session is actually allowed to save (mirrors
  // CREATABLE_ROLES / the profiles_insert & profiles_update RLS policies) —
  // e.g. an Employee only ever adds Interns/Externals, never another
  // Employee or a Manager.
  const roleRadios = document.querySelectorAll('input[name="e_role"]');
  const allowedRoles = CREATABLE_ROLES[session.role] || [];
  roleRadios.forEach(r => {
    r.disabled = false;
    r.closest('label').style.display = allowedRoles.includes(r.value) ? '' : 'none';
  });
  document.getElementById('e_selfRoleHint').style.display = 'none';

  // Admin can place someone on any team; a Manager can only place them on
  // one of the (possibly several) teams that Manager leads.
  const teamSelect = document.getElementById('e_team');
  const teamOptions = session.role === 'Manager' ? allTeams.filter(t => myTeamIds.includes(t.id)) : allTeams;
  teamSelect.innerHTML = '<option value="">No team</option>' +
    teamOptions.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

  if (id) {
    const member = allUsers.find(u => u.id === id);
    if (!member) return;
    document.getElementById('employeeModalTitle').textContent = 'Edit Member';
    document.getElementById('e_id').value = member.id;
    document.getElementById('e_employeeId').value = member.employeeId || '';
    document.getElementById('e_division').value = member.division;
    document.getElementById('e_name').value = member.name;
    document.getElementById('e_email').value = member.email;
    document.getElementById('e_password').value = '';
    document.getElementById('e_password').placeholder = 'Leave blank to keep unchanged';
    document.getElementById('e_password').required = false;
    roleRadios.forEach(r => { r.checked = r.value === member.role; });
    teamSelect.value = member.teamId || '';
    refreshSupervisorOptions(member.supervisorId);

    const isSelf = member.id === session.id;
    if (isSelf) {
      // Editing yourself: keep everything editable except the role you're
      // currently using — always show every role's radio here (even ones
      // this session couldn't newly assign to someone else) so your own
      // current role never disappears from view.
      roleRadios.forEach(r => { r.disabled = true; r.closest('label').style.display = ''; });
      document.getElementById('e_selfRoleHint').style.display = 'block';
      document.getElementById('employeeHint').textContent = "Share the email and password with them — they'll use them to sign in.";
    } else {
      // Editing someone else: Supabase Auth only allows a person to change
      // their own email/password, so those two fields are locked here.
      document.getElementById('e_email').disabled = true;
      document.getElementById('e_password').disabled = true;
      document.getElementById('e_password').placeholder = 'Only they can change this';
      document.getElementById('employeeHint').textContent = 'Only this person can change their own email or password, from their own account.';
    }
  } else {
    document.getElementById('employeeModalTitle').textContent = 'Add Member';
    document.getElementById('e_employeeId').value = '';
    document.getElementById('e_division').value = session.division || '';
    document.getElementById('e_password').placeholder = 'Set a login password';
    document.getElementById('employeeHint').textContent = "Share the email and password with them — they'll use them to sign in.";
    roleRadios.forEach(r => { r.checked = r.value === allowedRoles[0]; });
    teamSelect.value = session.role === 'Manager' ? (myTeamIds[0] || '') : '';
    refreshSupervisorOptions();
    updateEmployeeIdPlaceholder();
  }

  updateHierarchyFieldsVisibility();
  openModal('employeeModalBackdrop');
}

function updateEmployeeIdPlaceholder() {
  const role = document.querySelector('input[name="e_role"]:checked').value;
  document.getElementById('e_employeeId').placeholder = getNextUserId(role, allUsers);
}

// Rebuilds the Supervisor dropdown to just the Employees on whichever team
// is currently selected (Admin/Manager: the live value of the Team field,
// since a Manager may lead several and has to pick one; Employee: their own
// team, since their Team field is pinned/hidden) — a supervisor should
// always be a teammate of the person they supervise, not someone from a
// different team. Called on modal open and whenever the Team field changes.
// `preserveId`, if it's still in the rebuilt pool, stays selected; otherwise
// the field resets to "Unassigned" (e.g. after picking a different team,
// the old supervisor no longer belongs to it).
function refreshSupervisorOptions(preserveId) {
  const teamId = (session.role === 'Admin' || session.role === 'Manager')
    ? (document.getElementById('e_team').value || null)
    : session.teamId;
  const pool = allUsers.filter(u => u.role === 'Employee' && u.teamId === teamId);

  const supervisorSelect = document.getElementById('e_supervisor');
  supervisorSelect.innerHTML = '<option value="">Unassigned</option>' +
    pool.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');
  supervisorSelect.value = pool.some(u => u.id === preserveId) ? preserveId : '';
}

// The Team field only makes sense for roles that carry a team_id
// (Employee/Intern/External). Admin chooses freely among every team;
// Manager chooses among just the team(s) they lead (openEmployeeModal
// narrows the option list — a Manager leading only one team just sees a
// single, effectively-fixed option). An Employee adding their own hire is
// silently pinned to their own team (see onSaveEmployee), so the field
// would just be a confusing no-op for them.
//
// The Supervisor field only makes sense for roles that carry a
// supervisor_id (Intern/External), and only Admin/Manager choose it
// explicitly — an Employee adding their own hire is silently pinned as the
// supervisor.
function updateHierarchyFieldsVisibility() {
  const role = document.querySelector('input[name="e_role"]:checked').value;

  const showTeam = (session.role === 'Admin' || session.role === 'Manager') && TEAM_ROLES.includes(role);
  document.getElementById('e_teamField').style.display = showTeam ? 'block' : 'none';

  const showSupervisor = (session.role === 'Admin' || session.role === 'Manager') && SUPERVISED_ROLES.includes(role);
  document.getElementById('e_supervisorField').style.display = showSupervisor ? 'block' : 'none';
}

async function onSaveEmployee(e) {
  e.preventDefault();
  const id = document.getElementById('e_id').value;
  const isSelf = id === session.id;
  const payload = {
    employeeId: document.getElementById('e_employeeId').value.trim(),
    name: document.getElementById('e_name').value.trim(),
    email: document.getElementById('e_email').value.trim(),
    division: document.getElementById('e_division').value.trim(),
    password: document.getElementById('e_password').value,
    role: document.querySelector('input[name="e_role"]:checked').value,
  };

  // Only Employee/Intern/External carry a team_id (a Manager's "team(s)" is
  // whichever teams name them as manager, not something on their own
  // profile). Admin/Manager both pick from the dropdown (Manager's is
  // narrowed to just the team(s) they lead — see openEmployeeModal); an
  // Employee adding their own hire inherits the team they're already a
  // member of.
  if (TEAM_ROLES.includes(payload.role)) {
    if (session.role === 'Admin' || session.role === 'Manager') payload.teamId = document.getElementById('e_team').value || null;
    else payload.teamId = session.teamId || null;
  } else if (!isSelf) {
    payload.teamId = null;
  }

  // Only Intern/External carry a supervisor_id (which Employee they report
  // to). Admin/Manager pick it explicitly from the dropdown; an Employee
  // adding their own hire is silently pinned as the supervisor.
  if (SUPERVISED_ROLES.includes(payload.role)) {
    payload.supervisorId = session.role === 'Employee'
      ? session.id
      : (document.getElementById('e_supervisor').value || null);
  } else if (!isSelf) {
    payload.supervisorId = null;
  }

  let result;
  if (id) {
    if (!payload.employeeId) delete payload.employeeId; // keep existing ID if left blank
    if (isSelf) delete payload.role; // can't change your own role mid-session
    if (!isSelf) { delete payload.email; delete payload.password; } // only the account owner can change these
    result = await updateUser(id, payload, isSelf);
  } else {
    if (!payload.password) {
      showToast('Set a login password for this member.');
      return;
    }
    result = await addTeamMember(payload);
  }

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  // If the manager just edited their own record, keep this tab's session and topbar in sync.
  if (isSelf) {
    Object.assign(session, { name: result.user.name, email: result.user.email, division: result.user.division });
    document.getElementById('userName').textContent = session.name;
  }

  closeModal('employeeModalBackdrop');
  await refreshAndRender();
  fillEmployeeOptions();
  showToast(id ? 'Member updated.' : `Member added — ID ${result.user.employeeId}.`);
}

async function onDeleteEmployee(id) {
  const member = allUsers.find(u => u.id === id);
  if (!member) return;
  const activeCount = activeCountFor(member, allTasks);
  const noun = hasFullAccess(member.role) ? 'open assignment(s) they created' : 'active assignment(s)';
  const warning = activeCount ? `${member.name} has ${activeCount} ${noun}. ` : '';
  if (!confirm(`${warning}Delete ${member.name}'s account? This cannot be undone.`)) return;

  const result = await deleteUser(id, session.id);
  if (!result.ok) {
    showToast(result.error);
    return;
  }
  await refreshAndRender();
  fillEmployeeOptions();
  showToast('Member removed.');
}

// The password itself is never visible to anyone, including Admin — Supabase
// hashes it one-way at signup. This sets a brand new one instead; it's the
// server-side reset-password Edge Function that actually applies it (see
// resetPassword in js/auth.js and supabase/functions/reset-password).
function openResetPasswordModal(id) {
  const member = allUsers.find(u => u.id === id);
  if (!member) return;
  document.getElementById('resetPasswordForm').reset();
  document.getElementById('rp_id').value = id;
  document.getElementById('resetPasswordTitle').textContent = `Reset Password — ${member.name}`;
  openModal('resetPasswordModalBackdrop');
}

async function onResetPassword(e) {
  e.preventDefault();
  const id = document.getElementById('rp_id').value;
  const password = document.getElementById('rp_password').value;

  const result = await resetPassword(id, password);
  if (!result.ok) {
    showToast(result.error || 'Could not reset the password.');
    return;
  }
  closeModal('resetPasswordModalBackdrop');
  showToast('Password updated.');
}

/* ---------- Teams (Admin only) ---------- */

function teamName(id) {
  const team = allTeams.find(t => t.id === id);
  return team ? team.name : '—';
}

function renderTeams() {
  const tbody = document.getElementById('teamTableBody');
  const empty = document.getElementById('teamEmptyState');
  if (!tbody) return;

  if (!allTeams.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = allTeams.map(team => {
    const manager = allUsers.find(u => u.id === team.managerId);
    const memberCount = allUsers.filter(u => u.teamId === team.id).length;
    return `
      <tr>
        <td>${escapeHtml(team.name)}</td>
        <td>${manager ? escapeHtml(manager.name) : '<span style="color:var(--text-muted);">Unassigned</span>'}</td>
        <td>${memberCount}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" onclick="openTeamModal('${team.id}')">Edit</button>
            <button class="icon-btn" onclick="onDeleteTeam('${team.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openTeamModal(id) {
  const form = document.getElementById('teamForm');
  form.reset();
  document.getElementById('tm_id').value = '';

  const editingTeam = id ? allTeams.find(t => t.id === id) : null;

  // A Manager can lead any number of teams, so every Manager is always
  // offered here — nothing to exclude based on teams they already lead.
  const managerSelect = document.getElementById('tm_manager');
  const availableManagers = allUsers.filter(u => u.role === 'Manager');
  managerSelect.innerHTML = '<option value="">Unassigned</option>' +
    availableManagers.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');

  if (id) {
    if (!editingTeam) return;
    document.getElementById('teamModalTitle').textContent = 'Edit Team';
    document.getElementById('tm_id').value = editingTeam.id;
    document.getElementById('tm_name').value = editingTeam.name;
    managerSelect.value = editingTeam.managerId || '';
  } else {
    document.getElementById('teamModalTitle').textContent = 'New Team';
  }

  openModal('teamModalBackdrop');
}

async function onSaveTeam(e) {
  e.preventDefault();
  const id = document.getElementById('tm_id').value;
  const payload = {
    name: document.getElementById('tm_name').value.trim(),
    managerId: document.getElementById('tm_manager').value || null,
  };

  const result = id ? await updateTeam(id, payload) : await createTeam(payload);
  if (!result.ok) {
    showToast(result.error);
    return;
  }

  closeModal('teamModalBackdrop');
  await refreshAndRender();
  fillTeamFilterOptions();
  showToast(id ? 'Team updated.' : 'Team created.');
}

async function onDeleteTeam(id) {
  const team = allTeams.find(t => t.id === id);
  if (!team) return;
  const memberCount = allUsers.filter(u => u.teamId === team.id).length;
  const warning = memberCount ? `${memberCount} member(s) will become unassigned. ` : '';
  if (!confirm(`${warning}Delete "${team.name}"? This cannot be undone.`)) return;

  const result = await deleteTeam(id);
  if (!result.ok) {
    showToast(result.error);
    return;
  }
  await refreshAndRender();
  fillTeamFilterOptions();
  showToast('Team deleted.');
}

/* ---------- Create / Edit modal ---------- */

function openTaskModal(id) {
  const form = document.getElementById('taskForm');
  form.reset();
  document.getElementById('taskId').value = '';
  const assignedToSelect = document.getElementById('f_assignedTo');
  const assignedToLabel = document.querySelector('label[for="f_assignedTo"]');
  const canAssignOthers = hasFullAccess(session.role);
  const task = id ? allTasks.find(t => t.id === id) : null;
  if (id && !task) return;

  document.getElementById('f_statusApprovalHint').style.display = canAssignOthers ? 'none' : 'block';

  if (task) {
    document.getElementById('taskModalTitle').textContent = 'Edit Assignment';
    document.getElementById('taskId').value = task.id;
    document.getElementById('f_division').value = task.division;
    document.getElementById('f_priority').value = task.priority;
    document.getElementById('f_title').value = task.title;
    document.getElementById('f_description').value = task.description || '';
    assignedToSelect.value = task.assignedTo;
    document.getElementById('f_startDate').value = task.startDate;
    document.getElementById('f_dueDate').value = task.dueDate;
    // f_estimatedTime is a number input; older assignments stored this as
    // free text ("8 hrs", "1 hr.", ...), so pull out just the leading
    // number rather than setting it verbatim (a non-numeric string is
    // simply rejected by a number input, leaving it blank).
    const estMatch = /^[\d.]+/.exec(task.estimatedTime || '');
    document.getElementById('f_estimatedTime').value = estMatch ? estMatch[0] : '';
    document.getElementById('f_status').value = task.status;
    document.getElementById('f_remarks').value = task.remarks || '';
  } else {
    document.getElementById('taskModalTitle').textContent = canAssignOthers ? 'New Assignment' : 'New Task';
    document.getElementById('f_division').value = session.division || '';
    document.getElementById('f_status').value = 'Pending';
  }

  // Intern/External can only ever create/keep tasks assigned to themselves
  // — they can't hand work to (or take work from) someone else via this
  // form. A plain Manager still only ever assigns to their own team's
  // Employees, so "Assigned Employee" fits for them specifically; everyone
  // else's pool is mixed (Admin: Managers+Employees+Interns+External;
  // Employee: Interns+External) or single-person, so the generic label fits
  // better.
  assignedToLabel.textContent = session.role === 'Manager' ? 'Assigned Employee' : 'Assigned To';
  assignedToSelect.disabled = !canAssignOthers;
  if (!canAssignOthers) assignedToSelect.value = session.id;

  openModal('taskModalBackdrop');
}

async function onSaveTask(e) {
  e.preventDefault();
  const id = document.getElementById('taskId').value;

  // f_estimatedTime is just a bare number of hours now; store it the same
  // "N hrs" shape older free-text entries already used, so the Time column
  // reads consistently regardless of when an assignment was created.
  const estimatedHours = document.getElementById('f_estimatedTime').value.trim();

  const payload = {
    division: document.getElementById('f_division').value.trim(),
    priority: document.getElementById('f_priority').value,
    title: document.getElementById('f_title').value.trim(),
    description: document.getElementById('f_description').value.trim(),
    assignedTo: hasFullAccess(session.role) ? document.getElementById('f_assignedTo').value : session.id,
    startDate: document.getElementById('f_startDate').value,
    dueDate: document.getElementById('f_dueDate').value,
    estimatedTime: estimatedHours ? `${estimatedHours} hrs` : '',
    status: document.getElementById('f_status').value,
    remarks: document.getElementById('f_remarks').value.trim(),
  };

  if (new Date(payload.dueDate) < new Date(payload.startDate)) {
    showToast('Due date cannot be before the start date.');
    return;
  }

  // Marking their own assignment "Completed" here submits it for their
  // reporting manager's approval instead of actually completing it — see
  // requestsApproval.
  const originalTask = id ? allTasks.find(t => t.id === Number(id)) : null;
  const pendingApproval = requestsApproval(payload.status, payload.assignedTo, originalTask ? originalTask.status : null);
  if (pendingApproval) {
    payload.status = 'Pending Approval';
    payload.progress = 100;
  }

  let result;
  if (id) {
    const note = pendingApproval ? 'marked complete — submitted for approval' : `updated assignment "${payload.title}"`;
    result = await updateTask(Number(id), payload, session.id, note);
  } else {
    payload.assignedBy = session.id;
    if (payload.progress === undefined) payload.progress = 0;
    result = await createTask(payload, session.id);
  }

  if (!result.ok) {
    showToast(result.error || 'Could not save the assignment.');
    return;
  }

  closeModal('taskModalBackdrop');
  await refreshAndRender();
  showToast(pendingApproval ? 'Submitted for your manager\'s approval.' : (id ? 'Assignment updated.' : 'Assignment created.'));
}

/* ---------- Detail modal ---------- */

async function openDetailModal(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  activeTaskId = id;

  document.getElementById('detailTitle').textContent = task.title;
  document.getElementById('detailDescription').textContent = task.description || 'No description provided.';
  const detailRows = [
    ['Division', task.division],
    ['Assigned By', assignedByLabel(task, allUsers)],
    ['Assigned To', ownerName(task.assignedTo, allUsers)],
    ['Priority', task.priority],
    ['Start Date', formatDate(task.startDate)],
    ['Due Date', formatDate(task.dueDate)],
    ['Estimated Time', task.estimatedTime || '—'],
    ['Remarks', task.remarks || '—'],
  ].map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(String(v))}</td></tr>`).join('');
  document.getElementById('detailMeta').innerHTML = `<table class="detail-table"><tbody>${detailRows}</tbody></table>`;

  document.getElementById('detailStatus').value = task.status;
  document.getElementById('detailApprovalHint').style.display = isStaffRole(session.role) ? 'block' : 'none';
  document.getElementById('approveBtn').style.display =
    (hasFullAccess(session.role) && task.status === 'Pending Approval') ? 'inline-flex' : 'none';
  const progressInput = document.getElementById('detailProgress');
  progressInput.value = task.progress;
  progressInput.style.setProperty('--pct', `${task.progress}%`);
  document.getElementById('progressValue').textContent = `${task.progress}%`;

  openModal('detailModalBackdrop');
}

async function onSaveStatus() {
  if (!activeTaskId) return;
  const task = allTasks.find(t => t.id === activeTaskId);
  let status = document.getElementById('detailStatus').value;
  const progress = Number(document.getElementById('detailProgress').value);

  // Marking their own assignment "Completed" here submits it for their
  // reporting manager's approval instead of actually completing it — see
  // requestsApproval.
  const pendingApproval = requestsApproval(status, task ? task.assignedTo : null, task ? task.status : null);
  if (pendingApproval) status = 'Pending Approval';

  const changes = { status, progress: (status === 'Completed' || pendingApproval) ? 100 : progress };
  const note = pendingApproval ? 'marked complete — submitted for approval' : `set status to "${status}" (${changes.progress}%)`;
  const result = await updateTask(activeTaskId, changes, session.id, note);
  if (!result.ok) {
    showToast(result.error || 'Could not update status.');
    return;
  }
  closeModal('detailModalBackdrop');
  await refreshAndRender();
  showToast(pendingApproval ? 'Submitted for your manager\'s approval.' : 'Status updated.');
}

// Reporting-manager approval: the one action that actually promotes a
// Pending Approval assignment to Completed. Called both from the row-level
// "Approve" button (approveCompletion(id) via inline onclick, same pattern
// as openDetailModal/openTaskModal) and from the detail modal's Approve
// button (wired in boot(), reading the currently open activeTaskId).
async function approveCompletion(id) {
  const result = await updateTask(id, { status: 'Completed', progress: 100 }, session.id, 'approved completion');
  if (!result.ok) {
    showToast(result.error || 'Could not approve.');
    return;
  }
  if (activeTaskId === id) closeModal('detailModalBackdrop');
  await refreshAndRender();
  showToast('Marked Completed.');
}

/* ---------- Export ---------- */

// Downloads whatever the Reports tab is currently showing — every filter
// there (Status/Priority/Team/Mine/Search, plus the Updated From/To date
// range) applies. The old dedicated "Download Today's Report" button was
// just this same export with the date range pinned to a single day, so
// From = To now covers that case; leaving both blank exports everything, as
// before this feature existed at all. Always downloads a file, even an
// empty sheet when the filters match nothing, same as it always has — a
// click should never silently do nothing.
function onExport() {
  const from = document.getElementById('reportFilterFromDate').value;
  const to = document.getElementById('reportFilterToDate').value;
  if (from && to && from > to) {
    showToast('"Updated From" date is after "Updated To" — fix the range and try again.');
    return;
  }
  const filename = (from || to) ? `assignments-updated-${from || 'start'}_to_${to || 'now'}.xlsx` : 'assignments.xlsx';
  exportTasksToExcel(filteredReportTasks(), filename, allUsers);
}

/* ---------- Modal helpers ---------- */

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/* ---------- Small utils ---------- */

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}
