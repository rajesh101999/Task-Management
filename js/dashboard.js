/* dashboard.js — renders the role-aware dashboard and wires up all UI actions.
   Users/tasks/activity are fetched from Supabase once per refresh and cached
   in the module-level variables below; renders read from that cache so
   filtering/searching stays instant (no network round-trip per keystroke). */

let session = null;
let allUsers = [];
let allTasks = [];
let activeTaskId = null;

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  session = await requireAuth();
  if (!session) return; // requireAuth already redirected to index.html

  document.getElementById('userName').textContent = session.name;
  document.getElementById('userEmail').textContent = session.email;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  setupHeaderMenu();

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  if (hasFullAccess(session.role)) {
    document.getElementById('newTaskBtn').style.display = 'inline-flex';
    document.getElementById('tableTitle').textContent = 'All Assignments';
    document.getElementById('teamNavItem').style.display = 'flex';
    document.getElementById('newEmployeeBtn').addEventListener('click', () => openEmployeeModal());
    document.getElementById('employeeForm').addEventListener('submit', onSaveEmployee);
    document.getElementById('employeeSearch').addEventListener('input', renderEmployees);
    document.querySelectorAll('input[name="e_role"]').forEach(r => {
      r.addEventListener('change', updateEmployeeIdPlaceholder);
    });
  } else {
    document.getElementById('tableTitle').textContent = 'My Assignments';
    document.getElementById('workloadPanel').style.display = 'none';
    document.getElementById('newTaskBtn').textContent = '+ Add My Task';
    document.getElementById('newTaskBtn').style.display = 'inline-flex';
  }

  fillOptions(document.getElementById('filterStatus'), STATUSES, true);
  fillOptions(document.getElementById('filterPriority'), PRIORITIES, true);
  fillOptions(document.getElementById('f_priority'), PRIORITIES, false);
  fillOptions(document.getElementById('f_status'), STATUSES, false);
  fillOptions(document.getElementById('detailStatus'), STATUSES, false);

  document.getElementById('filterStatus').addEventListener('change', renderAll);
  document.getElementById('filterPriority').addEventListener('change', renderAll);
  document.getElementById('filterSearch').addEventListener('input', renderAll);
  document.getElementById('exportBtn').addEventListener('click', onExport);
  document.getElementById('newTaskBtn').addEventListener('click', () => openTaskModal());
  document.getElementById('taskForm').addEventListener('submit', onSaveTask);
  document.getElementById('saveStatusBtn').addEventListener('click', onSaveStatus);
  document.getElementById('addCommentBtn').addEventListener('click', onAddComment);
  document.getElementById('detailProgress').addEventListener('input', (e) => {
    document.getElementById('progressValue').textContent = `${e.target.value}%`;
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  await refreshData();
  fillEmployeeOptions();
  renderAll();
}

// Avatar opens/closes the profile dropdown (name, email, logout); the
// fullscreen icon is the one header action that's actually wired up.
// Dark mode / notifications are visual placeholders for now — no theme
// system or notification feed exists yet.
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

  document.getElementById('fullscreenBtn').addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
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

function fillEmployeeOptions() {
  const select = document.getElementById('f_assignedTo');
  select.innerHTML = '';
  allUsers.filter(u => u.role === 'Employee').forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = `${emp.name} (${emp.division})`;
    select.appendChild(opt);
  });
}

/* ---------- Fetch + cache ---------- */

async function refreshData() {
  [allUsers, allTasks] = await Promise.all([getUsers(), getTasks()]);
}

async function refreshAndRender() {
  await refreshData();
  renderAll();
}

/* ---------- Data scoping ---------- */

// Row Level Security already scopes `assignments` server-side (Managers see
// all, Employees see only what's assigned to them), so allTasks is already
// the right set — no client-side role filtering needed here.
function visibleTasks() {
  return allTasks;
}

function filteredTasks() {
  const status = document.getElementById('filterStatus').value;
  const priority = document.getElementById('filterPriority').value;
  const search = document.getElementById('filterSearch').value.trim().toLowerCase();

  return visibleTasks().filter(t => {
    if (status && t.status !== status) return false;
    if (priority && t.priority !== priority) return false;
    if (search && !`${t.title} ${t.division} ${ownerName(t.assignedTo, allUsers)}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

/* ---------- Render ---------- */

function renderAll() {
  renderKPIs();
  renderTable();
  if (hasFullAccess(session.role)) {
    renderWorkload();
    renderEmployees();
  }
}

/* ---------- Tabs ---------- */

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.getElementById('assignmentsView').style.display = tabId === 'assignmentsView' ? 'block' : 'none';
  document.getElementById('employeesView').style.display = tabId === 'employeesView' ? 'block' : 'none';
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
    // Employees can create tasks for themselves (t.assignedBy === them); those
    // get the same Edit/Delete as a Manager/Admin gets. Manager-assigned work
    // only ever gets "Update" (status/progress/comments via the detail modal).
    const isOwnTask = !hasFullAccess(session.role) && t.assignedBy === session.id;
    let actions;
    if (hasFullAccess(session.role)) {
      actions = `<button class="icon-btn" onclick="openDetailModal(${t.id})">View</button>
         <button class="icon-btn" onclick="openTaskModal(${t.id})">Edit</button>
         <button class="icon-btn" onclick="onDeleteTask(${t.id})">Delete</button>`;
    } else if (isOwnTask) {
      actions = `<button class="icon-btn" onclick="openDetailModal(${t.id})">Update</button>
         <button class="icon-btn" onclick="openTaskModal(${t.id})">Edit</button>
         <button class="icon-btn" onclick="onDeleteTask(${t.id})">Delete</button>`;
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
        <td><span class="progress-bar"><span style="width:${t.progress}%"></span></span>${t.progress}%</td>
        <td><div class="row-actions">${actions}</div></td>
      </tr>
    `;
  }).join('');
}

function renderWorkload() {
  const employees = allUsers.filter(u => u.role === 'Employee');
  const body = document.getElementById('workloadBody');

  if (!employees.length) {
    body.innerHTML = '<div class="empty-state">No employees yet.</div>';
    return;
  }

  body.innerHTML = employees.map(emp => {
    const count = allTasks.filter(t => t.assignedTo === emp.id && !['Completed', 'Cancelled'].includes(t.status)).length;
    return `<div class="workload-item"><span>${escapeHtml(emp.name)}</span><strong>${count} active</strong></div>`;
  }).join('');
}

// Active-work count shown per row: what an Employee is doing, or what a
// Manager/Admin currently has open (assignments they created that aren't
// wrapped up).
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
        <td>${activeCountFor(member, allTasks)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" onclick="openEmployeeModal('${member.id}')">Edit</button>
            <button class="icon-btn" onclick="onDeleteEmployee('${member.id}')" ${isSelf ? 'disabled title="You can\'t delete your own account"' : ''}>Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openEmployeeModal(id) {
  const form = document.getElementById('employeeForm');
  form.reset();
  document.getElementById('e_id').value = '';
  document.getElementById('e_password').required = true;
  document.getElementById('e_email').disabled = false;
  document.getElementById('e_password').disabled = false;

  const roleRadios = document.querySelectorAll('input[name="e_role"]');
  roleRadios.forEach(r => { r.disabled = false; });
  document.getElementById('e_selfRoleHint').style.display = 'none';

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

    const isSelf = member.id === session.id;
    if (isSelf) {
      // Editing yourself: keep everything editable except the role you're currently using.
      roleRadios.forEach(r => { r.disabled = true; });
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
    roleRadios.forEach(r => { r.checked = r.value === 'Employee'; });
    updateEmployeeIdPlaceholder();
  }

  openModal('employeeModalBackdrop');
}

function updateEmployeeIdPlaceholder() {
  const role = document.querySelector('input[name="e_role"]:checked').value;
  document.getElementById('e_employeeId').placeholder = getNextUserId(role, allUsers);
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

/* ---------- Create / Edit modal ---------- */

function openTaskModal(id) {
  const form = document.getElementById('taskForm');
  form.reset();
  document.getElementById('taskId').value = '';
  const assignedToSelect = document.getElementById('f_assignedTo');
  const assignedToLabel = document.querySelector('label[for="f_assignedTo"]');
  const isManager = hasFullAccess(session.role);

  if (id) {
    const task = allTasks.find(t => t.id === id);
    if (!task) return;
    document.getElementById('taskModalTitle').textContent = 'Edit Assignment';
    document.getElementById('taskId').value = task.id;
    document.getElementById('f_division').value = task.division;
    document.getElementById('f_priority').value = task.priority;
    document.getElementById('f_title').value = task.title;
    document.getElementById('f_description').value = task.description || '';
    assignedToSelect.value = task.assignedTo;
    document.getElementById('f_startDate').value = task.startDate;
    document.getElementById('f_dueDate').value = task.dueDate;
    document.getElementById('f_estimatedTime').value = task.estimatedTime || '';
    document.getElementById('f_status').value = task.status;
    document.getElementById('f_remarks').value = task.remarks || '';
  } else {
    document.getElementById('taskModalTitle').textContent = isManager ? 'New Assignment' : 'New Task';
    document.getElementById('f_division').value = session.division || '';
    document.getElementById('f_status').value = 'Pending';
  }

  // Employees can only ever create/keep tasks assigned to themselves — they
  // can't hand work to (or take work from) someone else via this form.
  assignedToLabel.textContent = isManager ? 'Assigned Employee' : 'Assigned To';
  assignedToSelect.disabled = !isManager;
  if (!isManager) assignedToSelect.value = session.id;

  openModal('taskModalBackdrop');
}

async function onSaveTask(e) {
  e.preventDefault();
  const id = document.getElementById('taskId').value;

  const payload = {
    division: document.getElementById('f_division').value.trim(),
    priority: document.getElementById('f_priority').value,
    title: document.getElementById('f_title').value.trim(),
    description: document.getElementById('f_description').value.trim(),
    assignedTo: hasFullAccess(session.role) ? document.getElementById('f_assignedTo').value : session.id,
    startDate: document.getElementById('f_startDate').value,
    dueDate: document.getElementById('f_dueDate').value,
    estimatedTime: document.getElementById('f_estimatedTime').value.trim(),
    status: document.getElementById('f_status').value,
    remarks: document.getElementById('f_remarks').value.trim(),
  };

  if (new Date(payload.dueDate) < new Date(payload.startDate)) {
    showToast('Due date cannot be before the start date.');
    return;
  }

  let result;
  if (id) {
    result = await updateTask(Number(id), payload, session.id, `updated assignment "${payload.title}"`);
  } else {
    payload.assignedBy = session.id;
    payload.progress = 0;
    result = await createTask(payload, session.id);
  }

  if (!result.ok) {
    showToast(result.error || 'Could not save the assignment.');
    return;
  }

  closeModal('taskModalBackdrop');
  await refreshAndRender();
  showToast(id ? 'Assignment updated.' : 'Assignment created.');
}

async function onDeleteTask(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
  const result = await deleteTask(id, session.id);
  if (!result.ok) {
    showToast(result.error || 'Could not delete the assignment.');
    return;
  }
  await refreshAndRender();
  showToast('Assignment deleted.');
}

/* ---------- Detail modal ---------- */

async function openDetailModal(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  activeTaskId = id;

  document.getElementById('detailTitle').textContent = task.title;
  document.getElementById('detailDescription').textContent = task.description || 'No description provided.';
  document.getElementById('detailMeta').innerHTML = [
    ['Division', task.division],
    ['Assigned By', ownerName(task.assignedBy, allUsers)],
    ['Assigned To', ownerName(task.assignedTo, allUsers)],
    ['Priority', task.priority],
    ['Start Date', formatDate(task.startDate)],
    ['Due Date', formatDate(task.dueDate)],
    ['Estimated Time', task.estimatedTime || '—'],
    ['Remarks', task.remarks || '—'],
  ].map(([k, v]) => `<div class="detail-row"><span class="k">${k}</span><span class="v">${escapeHtml(String(v))}</span></div>`).join('');

  document.getElementById('detailStatus').value = task.status;
  document.getElementById('detailProgress').value = task.progress;
  document.getElementById('progressValue').textContent = `${task.progress}%`;

  renderComments(await getComments(id));
  openModal('detailModalBackdrop');
}

function renderComments(comments) {
  const list = document.getElementById('commentList');
  list.innerHTML = comments.length
    ? comments.map(c => `
        <div class="comment-item">
          <span class="who">${escapeHtml(ownerName(c.user_id, allUsers))}</span>
          <span class="when">${formatDateTime(c.created_at)}</span>
          <div>${escapeHtml(c.text)}</div>
        </div>
      `).join('')
    : '<div class="empty-state">No comments yet.</div>';
}

async function onSaveStatus() {
  if (!activeTaskId) return;
  const status = document.getElementById('detailStatus').value;
  const progress = Number(document.getElementById('detailProgress').value);
  const changes = { status, progress: status === 'Completed' ? 100 : progress };
  const result = await updateTask(activeTaskId, changes, session.id, `set status to "${status}" (${changes.progress}%)`);
  if (!result.ok) {
    showToast(result.error || 'Could not update status.');
    return;
  }
  await refreshAndRender();
  showToast('Status updated.');
}

async function onAddComment() {
  if (!activeTaskId) return;
  const input = document.getElementById('commentInput');
  const text = input.value.trim();
  if (!text) return;
  const result = await addComment(activeTaskId, session.id, text);
  if (!result.ok) {
    showToast(result.error || 'Could not add the comment.');
    return;
  }
  input.value = '';
  renderComments(await getComments(activeTaskId));
  await refreshData();
}

/* ---------- Export ---------- */

function onExport() {
  exportTasksToExcel(filteredTasks(), 'assignments.xlsx', allUsers);
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
