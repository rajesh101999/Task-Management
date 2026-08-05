/* data.js — assignment (task) storage + activity log, backed by localStorage */

const TASKS_KEY = 'atd_tasks';
const ACTIVITY_KEY = 'atd_activities';

const STATUSES = ['Pending', 'Accepted', 'In Progress', 'Under Review', 'Completed', 'On Hold', 'Blocked', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

function seedTasks() {
  if (localStorage.getItem(TASKS_KEY)) return;
  const seed = [
    {
      id: 1,
      division: 'CDA',
      title: 'Website Content Update',
      description: 'Refresh homepage copy and update the services section with new offerings.',
      assignedBy: 'manager@demo.com',
      assignedTo: 'employee@demo.com',
      priority: 'High',
      status: 'In Progress',
      startDate: '2026-08-05',
      dueDate: '2026-08-08',
      estimatedTime: '8 hrs',
      actualTime: '',
      progress: 60,
      remarks: '',
      comments: [
        { user: 'Pavithra', text: 'Started on the homepage section.', date: '2026-08-05T09:15:00' },
      ],
      createdAt: '2026-08-05T09:00:00',
    },
  ];
  localStorage.setItem(TASKS_KEY, JSON.stringify(seed));
}

function getTasks() {
  seedTasks();
  return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]');
}

function saveTasks(tasks) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function getTask(id) {
  return getTasks().find(t => t.id === id);
}

function createTask(task, actor) {
  const tasks = getTasks();
  const newTask = {
    id: Date.now(),
    status: 'Pending',
    actualTime: '',
    progress: 0,
    comments: [],
    createdAt: new Date().toISOString(),
    ...task,
  };
  tasks.push(newTask);
  saveTasks(tasks);
  logActivity(newTask.id, `created assignment "${newTask.title}"`, actor);
  return newTask;
}

function updateTask(id, changes, actor, note) {
  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...changes };
  saveTasks(tasks);
  logActivity(id, note || 'updated assignment', actor);
  return tasks[idx];
}

function deleteTask(id, actor) {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === id);
  const remaining = tasks.filter(t => t.id !== id);
  saveTasks(remaining);
  if (task) logActivity(id, `deleted assignment "${task.title}"`, actor);
}

function addComment(id, user, text) {
  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  tasks[idx].comments = tasks[idx].comments || [];
  tasks[idx].comments.push({ user, text, date: new Date().toISOString() });
  saveTasks(tasks);
  logActivity(id, 'added a comment', user);
  return tasks[idx];
}

function logActivity(taskId, action, user) {
  const activities = getActivities();
  activities.unshift({ id: Date.now() + Math.random(), taskId, action, user, timestamp: new Date().toISOString() });
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activities.slice(0, 100)));
}

function getActivities() {
  return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
}

function isOverdue(task) {
  if (task.status === 'Completed' || task.status === 'Cancelled') return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function exportTasksToCSV(tasks, filename) {
  const headers = ['Division', 'Assignment', 'Owner', 'Status', 'Priority', 'Estimated Time', 'Start Date', 'Due Date', 'Progress'];
  const rows = tasks.map(t => [
    t.division, t.title, ownerName(t.assignedTo), t.status, t.priority, t.estimatedTime, t.startDate, t.dueDate, `${t.progress}%`,
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'assignments.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function ownerName(email) {
  const user = getUsers().find(u => u.email === email);
  return user ? user.name : email;
}
