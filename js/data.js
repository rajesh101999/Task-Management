/* data.js — assignments (tasks), comments, and the activity log, backed by
   Supabase/Postgres (see js/supabaseClient.js). Row Level Security on the
   `assignments`/`comments`/`activity_log` tables already scopes what each
   signed-in user can see, so these functions don't re-filter by role. */

const STATUSES = ['Pending', 'Accepted', 'In Progress', 'Under Review', 'Pending Approval', 'Completed', 'On Hold', 'Blocked', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

function mapTask(row) {
  return {
    id: row.id,
    division: row.division,
    title: row.title,
    description: row.description,
    assignedBy: row.assigned_by,
    assignedTo: row.assigned_to,
    priority: row.priority,
    status: row.status,
    startDate: row.start_date,
    dueDate: row.due_date,
    estimatedTime: row.estimated_time,
    actualTime: row.actual_time,
    progress: row.progress,
    remarks: row.remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getTasks() {
  const { data, error } = await sb.from('assignments').select('*').order('due_date');
  if (error) { console.error(error); return []; }
  return data.map(mapTask);
}

async function createTask(task, actorId) {
  const { data, error } = await sb.from('assignments').insert({
    division: task.division,
    title: task.title,
    description: task.description || '',
    assigned_by: task.assignedBy,
    assigned_to: task.assignedTo,
    priority: task.priority,
    status: task.status || 'Pending',
    start_date: task.startDate,
    due_date: task.dueDate,
    estimated_time: task.estimatedTime || '',
    progress: task.progress || 0,
    remarks: task.remarks || '',
  }).select().single();
  if (error) { console.error(error); return { ok: false, error: error.message }; }

  const newTask = mapTask(data);
  await logActivity(newTask.id, `created assignment "${newTask.title}"`, actorId);
  return { ok: true, task: newTask };
}

async function updateTask(id, changes, actorId, note) {
  const dbChanges = {};
  if (changes.division !== undefined) dbChanges.division = changes.division;
  if (changes.title !== undefined) dbChanges.title = changes.title;
  if (changes.description !== undefined) dbChanges.description = changes.description;
  if (changes.assignedTo !== undefined) dbChanges.assigned_to = changes.assignedTo;
  if (changes.priority !== undefined) dbChanges.priority = changes.priority;
  if (changes.status !== undefined) dbChanges.status = changes.status;
  if (changes.startDate !== undefined) dbChanges.start_date = changes.startDate;
  if (changes.dueDate !== undefined) dbChanges.due_date = changes.dueDate;
  if (changes.estimatedTime !== undefined) dbChanges.estimated_time = changes.estimatedTime;
  if (changes.progress !== undefined) dbChanges.progress = changes.progress;
  if (changes.remarks !== undefined) dbChanges.remarks = changes.remarks;

  const { data, error } = await sb.from('assignments').update(dbChanges).eq('id', id).select().single();
  if (error) { console.error(error); return { ok: false, error: error.message }; }

  await logActivity(id, note || 'updated assignment', actorId);
  return { ok: true, task: mapTask(data) };
}

async function deleteTask(id, actorId) {
  const { data: existing } = await sb.from('assignments').select('title').eq('id', id).single();
  const { error } = await sb.from('assignments').delete().eq('id', id);
  if (error) { console.error(error); return { ok: false, error: error.message }; }
  if (existing) await logActivity(null, `deleted assignment "${existing.title}"`, actorId);
  return { ok: true };
}

async function getComments(taskId) {
  const { data, error } = await sb.from('comments').select('*').eq('assignment_id', taskId).order('created_at');
  if (error) { console.error(error); return []; }
  return data;
}

async function addComment(taskId, userId, text) {
  const { error } = await sb.from('comments').insert({ assignment_id: taskId, user_id: userId, text });
  if (error) { console.error(error); return { ok: false, error: error.message }; }
  await logActivity(taskId, 'added a comment', userId);
  return { ok: true };
}

async function logActivity(assignmentId, action, userId) {
  const { error } = await sb.from('activity_log').insert({ assignment_id: assignmentId, action, user_id: userId });
  if (error) console.error(error);
}

async function getActivities() {
  const { data, error } = await sb.from('activity_log').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) { console.error(error); return []; }
  return data;
}

function isOverdue(task) {
  // Pending Approval sits alongside Completed/Cancelled here — the
  // Intern/External's own work on it is done, it's just waiting on their
  // reporting manager's sign-off, so it shouldn't flag as overdue on them.
  if (task.status === 'Completed' || task.status === 'Cancelled' || task.status === 'Pending Approval') return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// True when a task was last touched — created, edited, status/progress
// changed, reassigned — on or between fromDate/toDate (each a "YYYY-MM-DD"
// string straight from a <input type="date">, or '' for no bound on that
// side). updated_at is bumped by a DB trigger on every UPDATE (see
// supabase/migrations/2026-08-18_assignment-updated-at.sql), so this
// doesn't care which field actually changed. Compares calendar day in the
// browser's local timezone, inclusive of both ends — same-day range (from
// === to) is what a single "today" filter looks like here.
function isUpdatedInRange(task, fromDate, toDate) {
  if (!fromDate && !toDate) return true;
  if (!task.updatedAt) return false;
  const updated = new Date(task.updatedAt);
  updated.setHours(0, 0, 0, 0);
  // fromDate/toDate are "YYYY-MM-DD" strings straight from <input
  // type="date">; parsed as local midnight here (not new Date(str), which
  // reads that shape as UTC midnight and would drift by the browser's UTC
  // offset) so they compare correctly against `updated`, also local
  // midnight above.
  if (fromDate && updated < parseLocalDate(fromDate)) return false;
  if (toDate && updated > parseLocalDate(toDate)) return false;
  return true;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Looks up a display name from a profile id. Pure/sync: callers supply the
// current user list (a fresh fetch, or a cache) — see ownerName usage in
// dashboard.js, which keeps one around for the whole render pass.
function ownerName(id, users) {
  const user = (users || []).find(u => u.id === id);
  return user ? user.name : '—';
}

// "Assigned By" display for a task: a task someone created for themselves
// (Intern/External self-adding a task, or anyone assigning to themselves)
// reads better as "Self Assigned" than as their own name repeated right
// next to "Assigned To". Otherwise this is just ownerName — including its
// '—' fallback, which now only means "assigner's profile isn't visible to
// you" (RLS: 2026-08-24_assigned-by-visibility.sql lets you see whoever
// assigned *your own* tasks, but not an arbitrary other profile) rather
// than "never got set".
function assignedByLabel(task, users) {
  if (task.assignedBy && task.assignedBy === task.assignedTo) return 'Self Assigned';
  return ownerName(task.assignedBy, users);
}

// Looks up the team a profile belongs to (an Employee/Intern/External's own
// team_id) — used to filter assignments by their owner's team. A Manager or
// Admin has no team_id of their own (they lead teams rather than belong to
// one), so this only ever resolves for the roles that actually carry one.
function ownerTeamId(id, users) {
  const user = (users || []).find(u => u.id === id);
  return user ? user.teamId : null;
}

function exportTasksToExcel(tasks, filename, users) {
  const rows = tasks.map(t => ({
    Division: t.division,
    Assignment: t.title,
    Owner: ownerName(t.assignedTo, users),
    Status: t.status,
    Priority: t.priority,
    'Estimated Time': t.estimatedTime,
    'Start Date': t.startDate,
    'Due Date': t.dueDate,
    Progress: `${t.progress}%`,
    // formatDateTime is defined in js/dashboard.js, loaded after this file —
    // fine, since this only ever runs later from a button click, by which
    // point both scripts have finished loading.
    'Last Updated': formatDateTime(t.updatedAt),
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Assignments');
  XLSX.writeFile(workbook, filename || 'assignments.xlsx');
}
