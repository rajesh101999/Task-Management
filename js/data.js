/* data.js — assignments (tasks), comments, and the activity log, backed by
   Supabase/Postgres (see js/supabaseClient.js). Row Level Security on the
   `assignments`/`comments`/`activity_log` tables already scopes what each
   signed-in user can see, so these functions don't re-filter by role. */

const STATUSES = ['Pending', 'Accepted', 'In Progress', 'Under Review', 'Completed', 'On Hold', 'Blocked', 'Cancelled'];
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
  if (task.status === 'Completed' || task.status === 'Cancelled') return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// Looks up a display name from a profile id. Pure/sync: callers supply the
// current user list (a fresh fetch, or a cache) — see ownerName usage in
// dashboard.js, which keeps one around for the whole render pass.
function ownerName(id, users) {
  const user = (users || []).find(u => u.id === id);
  return user ? user.name : '—';
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
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Assignments');
  XLSX.writeFile(workbook, filename || 'assignments.xlsx');
}
