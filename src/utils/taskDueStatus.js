// Row highlighting for task tables: yellow the day before a task is due,
// red once the due date has arrived. Finished/in-review tasks are never
// flagged since they're no longer "at risk" of being late.
function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTaskDueRowStatus(task) {
  if (!task.due_date || task.status === "done" || task.status === "pending_review") return null;

  // Compare plain YYYY-MM-DD strings (no Date-object math) so this can't
  // drift by a day depending on the browser's UTC offset.
  const dueDateStr = task.due_date.slice(0, 10);

  const now = new Date();
  const todayStr = toLocalDateString(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toLocalDateString(tomorrow);

  if (dueDateStr <= todayStr) return "overdue";
  if (dueDateStr === tomorrowStr) return "due-soon";
  return null;
}

export function getDueRowClassName(task, baseClassName = "hover:bg-slate-50/70") {
  const status = getTaskDueRowStatus(task);
  if (status === "overdue") return "bg-red-50 hover:bg-red-100";
  if (status === "due-soon") return "bg-yellow-50 hover:bg-yellow-100";
  return baseClassName;
}
