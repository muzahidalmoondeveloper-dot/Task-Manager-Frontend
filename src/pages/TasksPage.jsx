import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Select from "../components/Select";
import toast from "react-hot-toast";

import { taskApi } from "../api/taskApi";
import { userApi } from "../api/userApi";
import { projectApi } from "../api/projectApi";
import { teamApi } from "../api/teamApi";
import { useAuth } from "../context/AuthContext";
import { useConfirm, usePrompt } from "../context/ConfirmContext";
import { usePageContext } from "../context/PageContext";
import CelebrationOverlay from "../components/CelebrationOverlay";
import DatePicker from "../components/DatePicker";
import TaskTimeTracker from "../components/TaskTimeTracker";
import WorkingTimeCell from "../components/WorkingTimeCell";
import { getDueRowClassName } from "../utils/taskDueStatus";
import { filterOrgAssignableUsers, getInlineAssigneeOptions } from "../utils/taskAssignees";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "todo",           label: "To Do"          },
  { value: "in_progress",   label: "In Progress"    },
  { value: "pending_review", label: "Pending Review" },
  { value: "done",           label: "Done"           },
];

const TEAM_MEMBER_STATUS_OPTIONS = [
  { value: "todo",         label: "To Do"       },
  { value: "in_progress", label: "In Progress" },
  { value: "done",         label: "Done"        },
];

const PRIORITY_OPTIONS = [
  { value: "high",   label: "High"   },
  { value: "medium", label: "Medium" },
  { value: "low",    label: "Low"    },
];

const initialForm = {
  name: "",
  description: "",
  start_date: "",
  due_date: "",
  assignee_id: "",
  project_id: "",
  team_id: "",
  status: "todo",
  priority: "medium",
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ds) {
  if (!ds) return "";
  return new Date(`${ds}T00:00:00`).toLocaleDateString();
}

function isOverdue(task) {
  if (!task.due_date || task.status === "done" || task.status === "pending_review") return false;
  return new Date(task.due_date) < new Date(new Date().toDateString());
}

function getStatusLabel(s) {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label || s;
}

function StatusBadge({ status }) {
  const classes = {
    done:           "bg-green-100 text-green-700",
    pending_review: "bg-amber-100 text-amber-700",
    in_progress:    "bg-blue-100  text-blue-700",
    todo:           "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${classes[status] || classes.todo}`}>
      {getStatusLabel(status)}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const classes = {
    high:   "bg-red-100   text-red-700",
    medium: "bg-amber-100 text-amber-700",
    low:    "bg-green-100 text-green-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${classes[priority] || classes.medium}`}>
      {priority || "medium"}
    </span>
  );
}

function DueDateCell({ task }) {
  if (!task.due_date) return <span className="text-slate-400">—</span>;
  const overdue = isOverdue(task);
  return (
    <span className={overdue ? "font-semibold text-red-600" : "text-slate-700"}>
      {formatDate(task.due_date)}
      {overdue && <span className="ml-1 text-[10px] font-bold uppercase text-red-500">Overdue</span>}
    </span>
  );
}

function EmptyState({ message, icon = "📋" }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="mb-3 text-4xl">{icon}</span>
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}

function ThreeDotsIcon() {
  // Vertical kebab (⋮) — three dots stacked on a shared x, not the
  // horizontal (…) row this used to render.
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
    </svg>
  );
}

function getMonthMatrix(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function toDateInputValue(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function getWeekDays(date) {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// Calendar redesign follow-up: "Today"/"Tomorrow" read naturally in Agenda;
// anything further out gets its weekday name plus a short date so the list
// stays scannable without repeating the current year on every row.
function formatAgendaDateLabel(dateKey, today) {
  const date = new Date(`${dateKey}T00:00:00`);
  const tomorrow = addDays(today, 1);
  const prefix = isSameDay(date, today) ? "Today" : isSameDay(date, tomorrow) ? "Tomorrow" : date.toLocaleDateString(undefined, { weekday: "long" });
  return `${prefix} — ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

// ─── Calendar task chip ─────────────────────────────────────────────────────
// Deliberately reuses only already-Dark-Mode-audited color pairs (the plain
// slate surface classes, and the same bare `text-red-500` "Overdue" tag
// DueDateCell already uses elsewhere on this page) rather than inventing new
// badge colors this design would need its own Dark Mode pass for.

function CalendarTaskChip({ task, onClick }) {
  const overdue = isOverdue(task);
  const priorityDotClass = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-emerald-500" }[task.priority] || "bg-amber-500";
  const contextLabel = task.project?.name || task.team?.name || null;
  const content = (
    <>
      <span className={`block truncate text-[11px] font-semibold ${task.status === "done" ? "text-slate-400 line-through" : "text-slate-800"}`}>
        {task.name}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${priorityDotClass}`} />
        <span className="capitalize">{task.priority || "medium"}</span>
        <span>•</span>
        <span className="truncate">{getStatusLabel(task.status)}</span>
        {overdue && <span className="font-bold uppercase text-red-500">Overdue</span>}
      </span>
      {contextLabel && <span className="block truncate text-[10px] text-slate-400">{contextLabel}</span>}
    </>
  );
  // No onClick means this actor has no permitted Task interaction to reuse
  // here (matches List/Board: a read-only role gets no Edit entry point
  // there either) — render an inert, non-interactive chip instead of a
  // button that would silently do nothing when clicked.
  if (!onClick) {
    return (
      <div title={task.name} className="block w-full truncate rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-left">
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onClick(task)}
      title={task.name}
      className="block w-full truncate rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-left hover:bg-slate-100"
    >
      {content}
    </button>
  );
}

const CALENDAR_SUBVIEWS = [
  { key: "month",  label: "Month"  },
  { key: "week",   label: "Week"   },
  { key: "agenda", label: "Agenda" },
];

// ─── Task Planning Calendar ─────────────────────────────────────────────────
// Shared by both My Tasks and All Tasks — takes the SAME already-filtered,
// already-scoped `tasks` array List/Board already use (no new fetch, no new
// backend endpoint, no client-side re-broadening of what the caller can
// see). Due Date is the primary calendar placement (matches this page's
// pre-existing due-date grouping); Start Date is surfaced only as a small,
// separate "Starts" line so a task never appears as two confusing full
// chips. Empty-day "create a Task here" was deliberately left out of this
// pass — My Tasks vs. All Tasks (self vs. project+team delegation) are two
// different creation flows with different required fields, and stamping a
// placeholder date into whichever one fires from a bare calendar click risks
// quietly encouraging the wrong shape of Task; flagged as a follow-up instead
// of guessing at a merged UX here.
function TaskCalendar({ tasks, filtersActive, onTaskClick, canClickTask }) {
  // Team Manager task-authority-precedence follow-up: `onTaskClick` used
  // to be an all-or-nothing prop — every chip on the calendar was either
  // clickable or none were. `canClickTask(task)`, when given, narrows
  // that PER TASK (e.g. My Tasks can mix tasks this actor fully manages
  // with ones they're merely the assignee of) — defaults to "always
  // clickable" so the All Tasks calendar (already server-prescoped, no
  // per-task predicate needed) keeps its exact existing behavior.
  const clickHandlerFor = (task) => (onTaskClick && (!canClickTask || canClickTask(task))) ? onTaskClick : undefined;
  const [subView, setSubView] = useState("month");
  const [cursorDate, setCursorDate] = useState(new Date());
  const [dayDetailKey, setDayDetailKey] = useState(null);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const tasksByDueDate = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      if (!t.due_date) return;
      (map[t.due_date] = map[t.due_date] || []).push(t);
    });
    return map;
  }, [tasks]);

  const tasksByStartDate = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      if (!t.start_date) return;
      (map[t.start_date] = map[t.start_date] || []).push(t);
    });
    return map;
  }, [tasks]);

  const monthDays = useMemo(() => getMonthMatrix(cursorDate.getFullYear(), cursorDate.getMonth()), [cursorDate]);
  const weekDays  = useMemo(() => getWeekDays(cursorDate), [cursorDate]);

  const agendaGroups = useMemo(() => {
    return Object.keys(tasksByDueDate).sort().map((key) => ({
      key,
      label: formatAgendaDateLabel(key, today),
      isOverdueGroup: new Date(`${key}T00:00:00`) < today,
      tasks: tasksByDueDate[key],
    }));
  }, [tasksByDueDate, today]);

  function goPrev() {
    setCursorDate((d) => (subView === "week" ? addDays(d, -7) : new Date(d.getFullYear(), d.getMonth() - 1, 1)));
  }
  function goNext() {
    setCursorDate((d) => (subView === "week" ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1)));
  }
  function goToday() {
    setCursorDate(new Date());
  }

  function renderDayCell(day, { faded = false } = {}) {
    const key = toDateInputValue(day);
    const dueTasks = tasksByDueDate[key] || [];
    // "Starts" is deliberately excluded whenever the same Task is already
    // shown as a due-date chip on this exact day — never the same Task
    // rendered twice on one date.
    const startingOnly = (tasksByStartDate[key] || []).filter((t) => t.due_date !== key);
    const isTodayCell = isSameDay(day, today);
    const visible = dueTasks.slice(0, 2);
    const overflowCount = dueTasks.length - visible.length;

    return (
      <div key={key} className={`min-h-28 border-r border-b border-slate-200 p-2 ${faded ? "bg-slate-50 text-slate-400" : ""}`}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className={
            isTodayCell
              ? "flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white"
              : "flex h-5 w-5 items-center justify-center text-xs font-semibold text-slate-700"
          }>
            {day.getDate()}
          </span>
          {dueTasks.length > 0 && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{dueTasks.length}</span>
          )}
        </div>
        <div className="space-y-1">
          {visible.map((task) => <CalendarTaskChip key={task.id} task={task} onClick={clickHandlerFor(task)} />)}
          {overflowCount > 0 && (
            <button type="button" onClick={() => setDayDetailKey(key)}
              className="block w-full rounded-md px-1.5 py-0.5 text-left text-[10px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900">
              +{overflowCount} more
            </button>
          )}
        </div>
        {startingOnly.length > 0 && (
          <p className="mt-1 truncate text-[9px] text-slate-400">
            Starts: {startingOnly.slice(0, 2).map((t) => t.name).join(", ")}{startingOnly.length > 2 ? ` +${startingOnly.length - 2}` : ""}
          </p>
        )}
      </div>
    );
  }

  const hasAnyTasks = tasks.length > 0;
  const dayDetailTasks = dayDetailKey ? (tasksByDueDate[dayDetailKey] || []) : [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={goPrev} aria-label="Previous"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">‹</button>
          <button type="button" onClick={goToday}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Today</button>
          <button type="button" onClick={goNext} aria-label="Next"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">›</button>
          <h2 className="ml-1 text-lg font-semibold text-slate-900">
            {subView === "week"
              ? `${weekDays[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${weekDays[6].getFullYear()}`
              : cursorDate.toLocaleString("default", { month: "long", year: "numeric" })}
          </h2>
        </div>
        <div className="flex w-fit items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          {CALENDAR_SUBVIEWS.map((v) => (
            <button key={v.key} type="button" onClick={() => setSubView(v.key)}
              className={v.key === subView
                ? "rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                : "rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {!hasAnyTasks ? (
        <EmptyState icon="🗓️" message={filtersActive ? "No tasks match the selected filters." : "No tasks scheduled."} />
      ) : subView === "agenda" ? (
        <div className="divide-y divide-slate-100 sm:max-h-[600px] sm:overflow-y-auto">
          {agendaGroups.length === 0 ? (
            <EmptyState icon="🗓️" message="No tasks scheduled." />
          ) : agendaGroups.map((group) => (
            <div key={group.key} className="px-6 py-4">
              <h3 className={`mb-2 text-sm font-semibold ${group.isOverdueGroup ? "text-red-600" : "text-slate-900"}`}>
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.tasks.map((task) => {
                  const overdue = isOverdue(task);
                  const contextLabel = task.project?.name || task.team?.name || null;
                  const rowClassName = "block w-full rounded-lg border border-slate-200 px-3 py-2 text-left" +
                    (onTaskClick ? " hover:border-slate-300 hover:bg-slate-50" : "");
                  const rowContent = (
                    <>
                      <p className={`text-sm font-medium ${task.status === "done" ? "text-slate-400 line-through" : "text-slate-900"}`}>
                        {task.name}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        {contextLabel && <span>{contextLabel}</span>}
                        {contextLabel && <span>•</span>}
                        <span className="capitalize">{task.priority || "medium"}</span>
                        <span>•</span>
                        <span>{getStatusLabel(task.status)}</span>
                        {overdue && <span className="font-bold uppercase text-red-500">Overdue</span>}
                      </p>
                    </>
                  );
                  // Same read-only rule as CalendarTaskChip: no click
                  // handler for THIS task means nothing exists for this
                  // actor to reuse here, so render an inert row instead
                  // of a dead button.
                  const rowClickHandler = clickHandlerFor(task);
                  return rowClickHandler ? (
                    <button key={task.id} type="button" onClick={() => rowClickHandler(task)} className={rowClassName}>
                      {rowContent}
                    </button>
                  ) : (
                    <div key={task.id} className={rowClassName}>{rowContent}</div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-7 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
              {(subView === "week" ? weekDays : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]).map((d) => (
                <div key={subView === "week" ? toDateInputValue(d) : d} className="border-r border-slate-200 p-3">
                  {subView === "week" ? `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}` : d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {(subView === "week" ? weekDays : monthDays).map((day) =>
                renderDayCell(day, { faded: subView === "month" && day.getMonth() !== cursorDate.getMonth() })
              )}
            </div>
          </div>
        </div>
      )}

      {dayDetailKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6" onClick={() => setDayDetailKey(null)}>
          <div className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {new Date(`${dayDetailKey}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </h3>
              <button type="button" onClick={() => setDayDetailKey(null)}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">✕</button>
            </div>
            <div className="space-y-2">
              {dayDetailTasks.map((task) => (
                <CalendarTaskChip
                  key={task.id}
                  task={task}
                  onClick={onTaskClick ? (t) => { setDayDetailKey(null); onTaskClick(t); } : null}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Task card for mobile ─────────────────────────────────────────────────────

function TaskCard({ task, canManageTasks, canEditTaskDetails, user, onEdit, onDelete, onStatusChange, onApprove, onAssignBack, reviewActionTaskId, workingTime, currentUserHasActiveTimer, onTimeChange }) {
  const overdue = isOverdue(task);

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${overdue ? "border-red-200" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-semibold leading-tight ${task.status === "done" ? "text-slate-400 line-through" : "text-slate-900"}`}>
          {task.name}
        </p>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
        </div>
      </div>

      {task.review_note && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
          Note: {task.review_note}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-500">
        {task.assignee && <p><span className="font-medium">Assignee:</span> {task.assignee.full_name}</p>}
        {task.project  && <p><span className="font-medium">Project:</span>  {task.project.name}</p>}
        {task.team     && <p><span className="font-medium">Team:</span>     {task.team.name}</p>}
        <p>
          <span className="font-medium">Start: </span>
          {task.start_date ? formatDate(task.start_date) : "—"}
        </p>
        <p>
          <span className="font-medium">Due: </span>
          {task.due_date ? (
            <span className={overdue ? "font-semibold text-red-600" : ""}>
              {formatDate(task.due_date)}{overdue && " ⚠"}
            </span>
          ) : "—"}
        </p>
      </div>

      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span className="font-medium">Working Time:</span>
        <WorkingTimeCell
          taskId={task.id}
          workingTimeSeconds={workingTime?.working_time_seconds}
          activeTimerCount={workingTime?.active_timer_count}
          currentUserIsActive={Boolean(workingTime?.current_user_is_active)}
          currentUserHasActiveTimerElsewhere={currentUserHasActiveTimer && !workingTime?.current_user_is_active}
          canControlTimer={task.assignee_id != null && task.assignee_id === user?.id}
          onTimeChange={onTimeChange}
        />
      </p>

      {/* Actions */}
      {canManageTasks && task.status === "pending_review" ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => onApprove(task)} disabled={reviewActionTaskId === task.id}
            className="flex-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60">
            Approve
          </button>
          <button type="button" onClick={() => onAssignBack(task)} disabled={reviewActionTaskId === task.id}
            className="flex-1 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60">
            Assign Back
          </button>
        </div>
      ) : canManageTasks ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => onEdit(task)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Edit
          </button>
          <button type="button" onClick={() => onDelete(task)}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
            Delete
          </button>
        </div>
      ) : canEditTaskDetails ? (
        <div className="mt-3">
          <button type="button" onClick={() => onEdit(task)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Edit Task
          </button>
        </div>
      ) : task.assignee_id === user?.id && task.status !== "pending_review" && task.status !== "done" ? (
        // Assignee-safe status control — independent of role (see
        // canFullyManageTask's own comment): a Team Manager who is
        // merely the assignee of this Task (not its Team's manager)
        // falls through to here exactly like a plain Team Member would.
        <div className="mt-3">
          <Select value={task.status} onChange={(e) => onStatusChange(task, e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            {TEAM_MEMBER_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
      ) : null}
    </div>
  );
}

// ─── Filters bar ──────────────────────────────────────────────────────────────

function FiltersBar({ filters, onChange, onReset, isActive, extraFilters = null }) {
  return (
    <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* Search */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Search</label>
          <input
            value={filters.search || ""}
            onChange={(e) => onChange("search", e.target.value)}
            placeholder="Task name…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-900"
          />
        </div>

        {/* Status */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Status</label>
          <Select value={filters.status || "all"} onChange={(e) => onChange("status", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-900">
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>

        {/* Priority */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Priority</label>
          <Select value={filters.priority || "all"} onChange={(e) => onChange("priority", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-900">
            <option value="all">All priorities</option>
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>

        {extraFilters}

        {/* Overdue toggle */}
        <div className="flex items-end">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={filters.overdue || false}
              onChange={(e) => onChange("overdue", e.target.checked)}
              className="h-4 w-4 rounded border-slate-400 accent-red-500"
            />
            Overdue only
          </label>
        </div>

        {/* Reset */}
        <div className="flex items-end">
          <button type="button" onClick={onReset} disabled={!isActive}
            className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
            Reset filters
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Task table row (module-level so the reference is stable across renders) ──
// Keeping this inside TasksPage would create a new function on every render,
// making React treat it as a new component type and remount all rows — which
// destroys the focused button and scrolls the page to the top.

function TaskTableRow({
  task,
  reviewActionId,
  canManageTasks,
  canEditTaskDetails,
  isTeamMember,
  userId,
  assignees,
  onQuickStatus,
  onQuickPriority,
  onQuickAssignee,
  onQuickDate,
  onApprove,
  onAssignBack,
  onToggleMenu,
  isPending,
  workingTime,
  currentUserHasActiveTimer,
  onTimeChange,
  assignableUsersByTeamId,
  assignableUsersLoading,
}) {
  const canChange = canEditTaskDetails || (
    isTeamMember &&
    task.assignee_id === userId &&
    task.status !== "pending_review" &&
    task.status !== "done"
  );

  const statusOpts = canEditTaskDetails
    ? STATUS_OPTIONS
    : (task.status === "pending_review" || task.status === "done")
      ? STATUS_OPTIONS.filter((o) => o.value === task.status)
      : TEAM_MEMBER_STATUS_OPTIONS;

  return (
    <tr className={getDueRowClassName(task)}>
      {/* Check circle */}
      <td className="px-4 py-4 align-middle">
        <button
          type="button"
          disabled={isPending || task.status === "pending_review" || (!canEditTaskDetails && task.assignee_id !== userId)}
          onClick={() => onQuickStatus(task, task.status === "done" ? "todo" : "done")}
          className={
            task.status === "done"
              ? "flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs text-white"
              : task.status === "pending_review"
              ? "flex h-5 w-5 cursor-not-allowed items-center justify-center rounded-full border border-amber-400 text-xs text-amber-500"
              : "flex h-5 w-5 items-center justify-center rounded-full border border-slate-400 text-xs text-slate-400 hover:border-slate-900 hover:text-slate-900"
          }
        >✓</button>
      </td>

      {/* Name */}
      <td className="px-4 py-4 align-middle">
        <span className={task.status === "done" ? "font-medium text-slate-400 line-through" : "font-medium text-slate-900"}>
          {task.name}
        </span>
        {task.review_note && <p className="mt-1 text-xs text-amber-600">Note: {task.review_note}</p>}
      </td>

      {/* Priority */}
      <td className="px-4 py-4 align-middle">
        {canEditTaskDetails ? (
          <Select value={task.priority || "medium"} disabled={isPending} onChange={(e) => onQuickPriority(task, e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold capitalize text-slate-700 focus:border-slate-900 focus:outline-none">
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ) : (
          <PriorityBadge priority={task.priority} />
        )}
      </td>

      {/* Project */}
      <td className="px-4 py-4 align-middle text-slate-700">{task.project?.name || "—"}</td>

      {/* Assignee */}
      <td className="px-4 py-4 align-middle text-slate-700">
        {canManageTasks ? (
          (() => {
            // Inline-assignee-dropdown bug-fix follow-up: Team eligibility
            // wins whenever this Task belongs to a Team (never the
            // org-wide `assignees` list) — sourced from the bulk
            // assignable-users lookup the parent already fetched for
            // every distinct team_id on screen, never a per-row fetch.
            const resolvedOptions = getInlineAssigneeOptions(task, { assignableUsersByTeamId, orgWideUsers: assignees });
            const stillLoadingThisTeam = task.team_id != null && resolvedOptions === undefined && assignableUsersLoading;
            const options = resolvedOptions ?? [];
            if (stillLoadingThisTeam) {
              return (
                <Select value="" disabled
                  className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-400">
                  <option value="">Loading members…</option>
                </Select>
              );
            }
            return (
              <Select value={task.assignee_id || ""} onChange={(e) => onQuickAssignee(task, e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-slate-900 focus:outline-none">
                <option value="">Unassigned</option>
                {options.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </Select>
            );
          })()
        ) : (
          task.assignee?.full_name || "Unassigned"
        )}
      </td>

      {/* Team */}
      <td className="px-4 py-4 align-middle text-slate-700">{task.team?.name || "—"}</td>

      {/* Start date */}
      <td className="px-4 py-4 align-middle text-slate-700">
        {canEditTaskDetails ? (
          <DatePicker
            value={task.start_date || ""}
            disabled={isPending}
            onChange={(e) => onQuickDate(task, "start_date", e.target.value)}
          />
        ) : task.start_date ? formatDate(task.start_date) : (
          <span className="text-slate-400">—</span>
        )}
      </td>

      {/* Due date */}
      <td className="px-4 py-4 align-middle">
        {canEditTaskDetails ? (
          <DatePicker
            value={task.due_date || ""}
            disabled={isPending}
            onChange={(e) => onQuickDate(task, "due_date", e.target.value)}
          />
        ) : (
          <DueDateCell task={task} />
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-4 align-middle">
        {canChange ? (
          <Select
            value={task.status}
            onChange={(e) => onQuickStatus(task, e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none"
          >
            {statusOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ) : (
          <StatusBadge status={task.status} />
        )}
      </td>

      {/* Working Time */}
      <td className="px-4 py-4 align-middle">
        <WorkingTimeCell
          taskId={task.id}
          workingTimeSeconds={workingTime?.working_time_seconds}
          activeTimerCount={workingTime?.active_timer_count}
          currentUserIsActive={Boolean(workingTime?.current_user_is_active)}
          currentUserHasActiveTimerElsewhere={currentUserHasActiveTimer && !workingTime?.current_user_is_active}
          canControlTimer={task.assignee_id != null && task.assignee_id === userId}
          onTimeChange={onTimeChange}
        />
      </td>

      {/* Actions */}
      {canEditTaskDetails ? (
        <td className="px-4 py-4 text-right align-middle">
          {canManageTasks && task.status === "pending_review" ? (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => onApprove(task)} disabled={reviewActionId === task.id}
                className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60">
                Approve
              </button>
              <button type="button" onClick={() => onAssignBack(task)} disabled={reviewActionId === task.id}
                className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60">
                Assign Back
              </button>
            </div>
          ) : (
            // A plain Project Manager joins this exact same kebab menu —
            // the shared fixed-position dropdown below only ever offers
            // this actor "Edit Task" (never Delete, never Approve/Assign
            // Back — those stay Owner/Admin/Team-Manager only, unaffected).
            <button
              type="button"
              onClick={(e) => onToggleMenu(e, task.id)}
              aria-label="Task actions"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <ThreeDotsIcon />
            </button>
          )}
        </td>
      ) : null}
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TasksPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { setPageContext, clearPageContext } = usePageContext();

  // Belt-and-suspenders: if the user navigates away from this page entirely
  // while a task's edit modal happened to be open, don't leave chat
  // thinking that task is still "on screen" indefinitely.
  useEffect(() => () => clearPageContext(), [clearPageContext]);

  const canManageTasks = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin || user?.role === "team_manager";
  const isTeamMember   = user?.role === "team_member";

  // Project Manager "All Tasks" follow-up: mirrors the backend's
  // `TenantContext.has_project_manager_access` exactly (base role OR the
  // granted `is_project_manager` flag) — the same condition
  // `require_org_manager_or_project_manager` now uses to admit a plain
  // Project Manager into GET /tasks. Deliberately kept SEPARATE from
  // `canManageTasks` above: a plain Project Manager may now VIEW the
  // All Tasks tab (server-side scoped to their managed projects), but
  // backend task mutation routes (update/delete/approve/assign-back) are
  // still `require_org_manager`-gated and do NOT include Project Manager
  // — so `canManageTasks` must stay exactly as it was, or PM would see
  // inline edit/delete/status/assignee controls that 403 on click.
  const hasProjectManagerAccess = user?.role === "project_manager" || Boolean(user?.is_project_manager);
  const canViewAllTasksTab = canManageTasks || hasProjectManagerAccess;
  // Project Manager Task-delegation follow-up: the exact "plain Project
  // Manager" actor this feature targets — PM capability WITHOUT any
  // Owner/Admin/Team-Manager capability. A hybrid user (PM+Admin,
  // PM+Owner, PM+Team Manager) keeps the existing full Create Task modal
  // below (canManageTasks), never this restricted one — capability, not
  // primary-role text, decides this, matching the backend's identical
  // `is_plain_project_manager` derivation in create_task().
  const isPlainProjectManager = hasProjectManagerAccess && !canManageTasks;

  // Project Manager Task-update follow-up: `canManageTasks` conflated two
  // genuinely different authorities — "may edit this task's core details"
  // and "may assign/reassign an individual person to it." A plain Project
  // Manager now has the first but never the second, so the single flag no
  // longer describes every row correctly. `canManageTasks` keeps its EXACT
  // original meaning below (Owner/Admin/Team Manager only — individual-
  // assignee authority is unchanged, e.g. the Assignee cell/field stays
  // gated on it alone); `canEditTaskDetails` adds a plain PM on top for
  // everything else (title, description, priority, status, dates, team).
  // Every task a PM sees here is already server-scoped to a project they
  // manage (My Tasks / All Tasks both query through the same backend
  // authorization this mirrors), so this never needs a per-row permission
  // check or extra request — a PM may treat every row in front of them as
  // editable-for-details.
  const canEditTaskDetails = canManageTasks || isPlainProjectManager;

  const [searchParams, setSearchParams] = useSearchParams();

  // Primary view tab
  const primaryTab = searchParams.get("tab") || "my_tasks";
  function setPrimaryTab(tabId) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tabId);
    setSearchParams(next);
  }

  // Secondary view (within My Tasks)
  const myViewMode = searchParams.get("my_view") || "list";
  function setMyViewMode(mode) {
    const next = new URLSearchParams(searchParams);
    next.set("my_view", mode);
    setSearchParams(next);
  }

  // Secondary view (within All Tasks)
  const viewMode = searchParams.get("all_view") || "list";
  function setViewMode(mode) {
    const next = new URLSearchParams(searchParams);
    next.set("all_view", mode);
    setSearchParams(next);
  }

  // Data
  const [myTasks,  setMyTasks]  = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [users,    setUsers]    = useState([]);
  const [projects, setProjects] = useState([]);
  const [teams,    setTeams]    = useState([]);
  // Team Manager Create-Task-form follow-up: project_id -> the subset of
  // THIS caller's own managed Teams attached to it (from GET
  // /projects/for-managed-teams) — used as the classic Create/Edit Task
  // modal's Project->Team fallback whenever GET /projects/{id}/items is
  // blocked for the current actor (a plain Team Manager).
  const [managedTeamProjectMap, setManagedTeamProjectMap] = useState({});

  // Team Manager task-authority-precedence follow-up (bug fix): the flat
  // `canManageTasks`/`canEditTaskDetails` above are correct for "All
  // Tasks" (server-scoped to teams/projects this user actually manages —
  // see list_tasks()'s own scope_team_ids/scope_project_ids) but were
  // ALSO being used, unscoped, for "My Tasks" — which the backend scopes
  // by ASSIGNEE, not by managed Team/Project. A Team Manager's "My
  // Tasks" can include a Task from a Team they do NOT manage (they're
  // just its assignee); the flat flags wrongly presented full edit
  // controls for it, and the backend correctly rejected the save with
  // "As the assignee, you may only update this task's status." — a
  // stronger authority (managing THIS task's Team) must never be
  // downgraded by also being the assignee, but a WEAKER one (merely
  // being the assignee, on a Team this user doesn't manage) must never
  // be shown as if it were the stronger one either. These two helpers
  // recompute the SAME precedence the backend's
  // require_task_update_access/is_team_manager_scoped_to_task use, PER
  // TASK, for every place that shows/submits edit controls for a task
  // that isn't guaranteed to already be inside a server-prescoped list.
  const managedTeamIds = useMemo(
    () => new Set((teams || []).filter((t) => t.team_manager_id === user?.id).map((t) => t.id)),
    [teams, user?.id]
  );
  // Granted-flag Team Manager (`is_team_manager`), not just the literal
  // primary role — `canManageTasks` above only checks the literal role
  // string, which already matches the backend's own `is_manager_or_above`
  // (role OR granted flag) for every OTHER capability in this app.
  const isTeamManagerCapable = user?.role === "team_manager" || Boolean(user?.is_team_manager);

  // Task ownership/personal-task follow-up: a Personal/Standalone Task
  // (no Team — e.g. an AI-generated Task with no Team resolved) is owned
  // by whoever it's assigned to, a DIFFERENT and STRONGER concept than a
  // bare Team Task assignee (see the backend's identical
  // is_personal_task_owner — team_id IS NULL and I AM the assignee).
  // Mirrors the backend exactly: no role check beyond excluding Client
  // (never a legal assignee at all).
  function isPersonalTaskOwner(task) {
    return Boolean(task) && task.team_id == null && task.assignee_id === user?.id && user?.role !== "client";
  }

  function canFullyManageTask(task) {
    if (!task) return false;
    if (user?.role === "owner" || user?.role === "admin" || user?.is_org_admin) return true;
    if (isTeamManagerCapable && task.team_id != null && managedTeamIds.has(task.team_id)) return true;
    return isPersonalTaskOwner(task);
  }

  function canEditTaskDetailsFor(task) {
    return canFullyManageTask(task) || isPlainProjectManager;
  }

  // Personal-Task-edit-payload follow-up (Issue 2): the Edit Task modal
  // used to always send the FULL field set on submit, including
  // `assignee_id` re-sent at its current, UNCHANGED value — for a
  // Personal Task owner (team_id NULL, they ARE the assignee), that
  // "no-op" resend still hits the backend's PERSONAL_TASK_OWNER_ALLOWED_
  // FIELDS whitelist, which deliberately excludes `assignee_id`, so the
  // whole PATCH was rejected outright, even though the user only meant
  // to change e.g. Priority. Fix: diff the form against the task's own
  // current values and submit only what actually changed — mirrors what
  // a hand-written, careful PATCH client would do, and is required
  // regardless of role (an Owner/Admin/Team Manager editing someone
  // else's task benefits from the same smaller, more honest PATCH).
  // `assignee_id` is otherwise NEVER included for a Personal Task owner's
  // own edit — the Personal Task owner never "reassigns" through this
  // path; only an explicit Team-Manager/Owner/Admin assignee change (a
  // task they fully manage via Team scope) may submit it. The ONE
  // exception (Edit-Task-flow follow-up — Personal Task -> managed Team
  // Task transition): when `team_id` is ALSO changing away from NULL in
  // this same diff, `assignee_id` is allowed through too, so a Team
  // Manager can pick both the Team and its new owner in a single Save —
  // no Save-then-reopen round trip. This only decides whether the FIELD
  // rides along; the backend's own `is_personal_to_managed_team_transition`
  // check is the actual authorization boundary (caller must legitimately
  // manage that exact target team, target assignee re-validated in full)
  // — sending it when unauthorized just gets rejected, exactly like any
  // other manipulated request.
  function buildChangedTaskFields(original, form) {
    if (!original) return {};
    const candidates = {
      name:        form.name,
      description: form.description || null,
      start_date:  form.start_date || null,
      due_date:    form.due_date   || null,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
      project_id:  form.project_id  ? Number(form.project_id)  : null,
      team_id:     form.team_id     ? Number(form.team_id)     : null,
      status:      form.status,
      priority:    form.priority,
    };
    const originals = {
      name:        original.name || "",
      description: original.description || null,
      start_date:  original.start_date || null,
      due_date:    original.due_date   || null,
      assignee_id: original.assignee_id ?? null,
      project_id:  original.project_id  ?? null,
      team_id:     original.team_id     ?? null,
      status:      original.status || "",
      priority:    original.priority || "",
    };
    const isTransitioningToTeam = candidates.team_id !== originals.team_id && candidates.team_id !== null;
    const changed = {};
    for (const key of Object.keys(candidates)) {
      if (key === "assignee_id" && isPersonalTaskOwner(original) && !isTransitioningToTeam) continue;
      if (candidates[key] !== originals[key]) changed[key] = candidates[key];
    }
    return changed;
  }

  // Loading / error
  const [myTasksLoading,  setMyTasksLoading]  = useState(true);
  const [allTasksLoading, setAllTasksLoading] = useState(false);
  const [myTasksError,    setMyTasksError]    = useState("");
  const [allTasksError,   setAllTasksError]   = useState("");

  // Project Manager Task-update follow-up / duplicate-toast fix: a task
  // whose id is in this set has an inline quick-mutation (status/priority/
  // date) already in flight — the row disables that control until it
  // settles, so a repeated click (or a slow/failing request) can never
  // fire a second identical PATCH and therefore can never produce a
  // second identical toast. This is plain double-submit protection, not
  // error suppression: a genuine failure still toasts exactly once.
  const [pendingTaskIds, setPendingTaskIds] = useState(() => new Set());
  function markTaskPending(taskId, isPending) {
    setPendingTaskIds((prev) => {
      const next = new Set(prev);
      if (isPending) next.add(taskId); else next.delete(taskId);
      return next;
    });
  }

  // My Tasks filters
  const [myFilters, setMyFilters] = useState({ search: "", status: "all", priority: "all", overdue: false });

  // All Tasks filters
  const [allFilters, setAllFilters] = useState({
    search: "", status: "all", priority: "all", assignee: "all",
    project: "all", team: "all", overdue: false, dueDateFrom: "", dueDateTo: "",
  });

  // Form / modal state (shared)
  const [formData,       setFormData]       = useState(initialForm);
  const [editingTaskId,  setEditingTaskId]  = useState(null);
  const [isModalOpen,    setIsModalOpen]    = useState(false);
  const [isSubmitting,   setIsSubmitting]   = useState(false);
  const [formError,      setFormError]      = useState("");
  const [openMenuId,     setOpenMenuId]     = useState(null);
  // Project Manager Task-delegation follow-up: which of the two PM
  // creation modes is open — "self" ("+ Add My Task": personal work,
  // fixed to the PM, no Team) or "project_team" ("+ Add Project Task":
  // delegated to a Team, no individual Assignee at all). `null` means
  // the classic full Owner/Admin/Team-Manager modal is in play instead
  // (or no modal is open) — these two flows are rendered by entirely
  // separate JSX below, never sharing stale field state.
  const [pmCreateMode, setPmCreateMode] = useState(null);
  const [pmModalProjectTeams, setPmModalProjectTeams] = useState([]);
  const [isPmModalTeamsLoading, setIsPmModalTeamsLoading] = useState(false);
  const [menuPos,        setMenuPos]        = useState(null);
  const [reviewActionId, setReviewActionId] = useState(null);
  const [celebrationData,setCelebrationData]= useState(null);

  const isEditing = editingTaskId !== null;

  // ─── Data loading ───────────────────────────────────────────────────────────

  async function loadMyTasks() {
    setMyTasksLoading(true);
    setMyTasksError("");
    try {
      const data = await taskApi.listMy();
      setMyTasks(data);
    } catch (err) {
      setMyTasksError(err.message || "Unable to load your tasks.");
    } finally {
      setMyTasksLoading(false);
    }
  }

  async function loadAllTasks() {
    setAllTasksLoading(true);
    setAllTasksError("");
    try {
      const data = await taskApi.list();
      setAllTasks(data);
    } catch (err) {
      setAllTasksError(err.message || "Unable to load all tasks.");
    } finally {
      setAllTasksLoading(false);
    }
  }

  async function loadFilterData() {
    // Project Manager "All Tasks" follow-up: GET /users (userApi.list()) is
    // require_org_admin-gated — a plain Project Manager doesn't have (and
    // must not be given) org-wide Users access, so it's never called for
    // them at all here (Phase 14 — never fall back to organization-wide
    // Users). GET /projects and GET /teams are already correctly scoped
    // server-side for a Project Manager (project membership / managed
    // team respectively), so those still load normally.
    //
    // Settled independently (never Promise.all) so one endpoint a role
    // isn't permitted to call can't also blank out the Project/Team
    // filter options this role DOES have legitimate access to.
    // Team Manager Create-Task-form follow-up: GET /projects/for-managed-teams
    // is the scoped, additive source for a plain Team Manager (whose GET
    // /projects is always empty by design) — settled independently too, so
    // it never blanks out the org-wide `projects` result for Owner/Admin/PM.
    // `team_ids` from this call still feeds the Project->Team cascade
    // (`managedTeamProjectMap`) below — kept even though the PROJECT LIST
    // itself now also gets the broader org-wide source next.
    //
    // Team Manager Project-dropdown follow-up: `for-managed-teams` alone
    // is still too narrow for the actual product rule — it only returns
    // Projects already attached to a Team this caller manages via the
    // explicit Project<->Team association, which can legitimately be
    // empty even when the organization has real Projects (the exact
    // reported bug: a brand-new managed Team with no Project attached
    // yet left the dropdown empty). `GET /projects/options` is the
    // canonical "every active Project in this organization" source —
    // fetched for anyone who ISN'T a plain Project Manager (who keeps
    // their existing, unchanged, ProjectMembership-scoped `GET /projects`
    // result — this task never asked to broaden PM's own Project
    // visibility, only a plain Team Manager's).
    const [userResult, projectResult, teamResult, managedTeamProjectResult, projectOptionsResult] = await Promise.allSettled([
      canManageTasks ? userApi.list() : Promise.resolve([]),
      projectApi.list(),
      teamApi.list(),
      projectApi.listForManagedTeams(),
      isPlainProjectManager ? Promise.resolve([]) : projectApi.options(),
    ]);
    if (userResult.status === "fulfilled") setUsers(userResult.value);
    if (teamResult.status === "fulfilled") setTeams(teamResult.value);

    const baseProjects = projectResult.status === "fulfilled" ? projectResult.value : [];
    const managedTeamProjects = managedTeamProjectResult.status === "fulfilled" ? managedTeamProjectResult.value : [];
    const orgProjectOptions = projectOptionsResult.status === "fulfilled" ? projectOptionsResult.value : [];

    const merged = new Map(baseProjects.map((p) => [p.id, p]));
    for (const p of managedTeamProjects) if (!merged.has(p.id)) merged.set(p.id, p);
    for (const p of orgProjectOptions) if (!merged.has(p.id)) merged.set(p.id, p);
    setProjects(Array.from(merged.values()));
    if (managedTeamProjects.length) {
      setManagedTeamProjectMap(Object.fromEntries(managedTeamProjects.map((p) => [p.id, p.team_ids])));
    }
  }

  // Bulk Working Time for both task tables on this page — ONE request per
  // refresh for however many tasks are currently loaded across My Tasks +
  // All Tasks combined, never one `/tasks/{id}/time` per row.
  const [taskWorkingTimes, setTaskWorkingTimes] = useState({});
  // #7A allows only ONE active timer per user across the whole org — this
  // tracks whether the CALLER already has one running anywhere, so every
  // OTHER row's Start button can be disabled (Start/Stop-from-list
  // follow-up). Per-row "is it MY timer" always comes from each item's
  // own `current_user_is_active`, never from `active_timer_count` (which
  // describes the task aggregate and may be > 0 purely from other users).
  const [currentUserHasActiveTimer, setCurrentUserHasActiveTimer] = useState(false);
  async function refreshTaskWorkingTimes() {
    const ids = Array.from(new Set([...myTasks.map((t) => t.id), ...allTasks.map((t) => t.id)]));
    if (!ids.length) {
      setTaskWorkingTimes({});
      setCurrentUserHasActiveTimer(false);
      return;
    }
    try {
      const data = await taskApi.getTimeSummaries(ids);
      setTaskWorkingTimes(data.items || {});
      setCurrentUserHasActiveTimer(Boolean(data.current_user_has_active_timer));
    } catch {
      // Working Time is a secondary metric on this list — leave it as-is.
    }
  }

  useEffect(() => {
    loadMyTasks();
    if (canViewAllTasksTab) {
      loadAllTasks();
      loadFilterData();
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshTaskWorkingTimes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTasks, allTasks]);

  // ─── Filter logic ───────────────────────────────────────────────────────────

  function applyFilters(tasks, filters, { includeAssignee = false, includeProject = false, includeTeam = false } = {}) {
    const q = (filters.search || "").trim().toLowerCase();
    const today = new Date(new Date().toDateString());

    return tasks.filter((t) => {
      if (q) {
        const text = [t.name, t.project?.name, t.assignee?.full_name, t.team?.name].filter(Boolean).join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      if (filters.status && filters.status !== "all" && t.status !== filters.status) return false;
      if (filters.priority && filters.priority !== "all" && (t.priority || "medium") !== filters.priority) return false;
      if (includeAssignee && filters.assignee && filters.assignee !== "all" && String(t.assignee_id) !== filters.assignee) return false;
      if (includeProject  && filters.project  && filters.project  !== "all" && String(t.project_id)  !== filters.project)  return false;
      if (includeTeam     && filters.team     && filters.team     !== "all" && String(t.team_id)     !== filters.team)     return false;
      if (filters.dueDateFrom && t.due_date && t.due_date < filters.dueDateFrom) return false;
      if (filters.dueDateTo   && t.due_date && t.due_date > filters.dueDateTo)   return false;
      if (filters.overdue && !(t.due_date && new Date(t.due_date) < today && t.status !== "done" && t.status !== "pending_review")) return false;
      return true;
    });
  }

  const filteredMyTasks = useMemo(() => applyFilters(myTasks, myFilters), [myTasks, myFilters]);

  const filteredAllTasks = useMemo(
    () => applyFilters(allTasks, allFilters, { includeAssignee: true, includeProject: true, includeTeam: true }),
    [allTasks, allFilters]
  );

  const groupedMyByStatus = useMemo(() =>
    STATUS_OPTIONS.reduce((acc, s) => { acc[s.value] = filteredMyTasks.filter((t) => t.status === s.value); return acc; }, {}),
    [filteredMyTasks]
  );

  const groupedByStatus = useMemo(() =>
    STATUS_OPTIONS.reduce((acc, s) => { acc[s.value] = filteredAllTasks.filter((t) => t.status === s.value); return acc; }, {}),
    [filteredAllTasks]
  );

  // ─── Filter options (for All Tasks dropdowns) ───────────────────────────────

  const assigneeOptions = useMemo(() => {
    const map = new Map();
    allTasks.forEach((t) => { if (t.assignee_id && t.assignee?.full_name) map.set(String(t.assignee_id), t.assignee.full_name); });
    users.forEach((u) => map.set(String(u.id), u.full_name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allTasks, users]);

  const projectOptions = useMemo(() => {
    const map = new Map();
    allTasks.forEach((t) => { if (t.project_id && t.project?.name) map.set(String(t.project_id), t.project.name); });
    projects.forEach((p) => map.set(String(p.id), p.name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allTasks, projects]);

  const teamOptions = useMemo(() => {
    const map = new Map();
    allTasks.forEach((t) => { if (t.team_id && t.team?.name) map.set(String(t.team_id), t.team.name); });
    teams.forEach((t) => map.set(String(t.id), t.name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allTasks, teams]);

  // Rule F fallback (Task Assignee bug-fix follow-up): eligible assignees
  // when the Task being created/edited has no team_id — org-wide, minus
  // Client (see utils/taskAssignees.js, the same helper TasksPage,
  // ProjectDetailPage, and TeamDetailPage all share instead of each
  // re-implementing their own role allowlist).
  const assignees = useMemo(() => filterOrgAssignableUsers(users), [users]);

  // Task Assignee bug-fix follow-up (Rule B/C): once a Team is picked in
  // the Create/Edit Task modal, the Assignee dropdown must be scoped to
  // THAT team's eligible members only — never the whole organization,
  // regardless of the viewer being Owner/Admin/Team Manager. Fetched via
  // the same team-scoped `GET /teams/{id}/assignable-users` TeamDetailPage
  // uses, not the org-wide user list above.
  const [teamAssignableUsers, setTeamAssignableUsers] = useState([]);
  useEffect(() => {
    const teamId = formData.team_id;
    Promise.resolve(teamId ? teamApi.getAssignableUsers(teamId) : [])
      .then((members) => {
        const list = Array.isArray(members) ? members : [];
        setTeamAssignableUsers(list);
        // Team Manager Create-Task-form follow-up: changing Team must
        // clear/revalidate an Assignee who doesn't belong to the newly
        // selected Team — never silently leave a stale, now-invalid
        // assignee_id in the form.
        if (teamId) {
          setFormData((p) => (
            p.assignee_id && p.team_id === teamId && !list.some((u) => String(u.id) === String(p.assignee_id))
              ? { ...p, assignee_id: "" }
              : p
          ));
        }
      })
      .catch(() => setTeamAssignableUsers([]));
  }, [formData.team_id]);

  // The dropdown's actual option source: Team eligibility wins whenever a
  // team is selected (Rule B/C precedence), org-wide list otherwise.
  //
  // Task ownership/default-assignee follow-up: when no Team is selected,
  // the current user must ALWAYS be a selectable option here, even if
  // the org-wide `assignees` list is empty for this role (GET /users is
  // Owner/Admin-only — a plain Team Manager's `assignees` is legitimately
  // `[]`). Without this, the preselected "Assign to me" default above has
  // no matching <option> to actually render/select, and a Team Manager
  // would have no way to explicitly confirm the default at all.
  const modalAssignees = formData.team_id
    ? teamAssignableUsers
    : (user?.id && !assignees.some((a) => String(a.id) === String(user.id))
        ? [{ id: user.id, full_name: user.full_name || user.email }, ...assignees]
        : assignees);

  // Team Manager Create-Task-form follow-up: Project->Team dependency.
  // null = no restriction (no Project selected, or the source couldn't
  // resolve one way or the other yet) — Team dropdown then shows every
  // Team this actor already has (Owner/Admin: every org Team; Team
  // Manager: their own managed Teams, from the existing, already-correct
  // GET /teams). A non-null array narrows the Team dropdown to exactly
  // that Project's attached Teams.
  const [modalProjectTeamIds, setModalProjectTeamIds] = useState(null);
  useEffect(() => {
    const projectId = formData.project_id;
    if (!projectId) { setModalProjectTeamIds(null); return; }
    let cancelled = false;
    projectApi.listItems(projectId)
      .then((items) => {
        if (cancelled) return;
        setModalProjectTeamIds((items?.teams || []).map((t) => t.id));
      })
      .catch(() => {
        if (cancelled) return;
        // GET /projects/{id}/items is blocked for a plain Team Manager
        // (require_project_management_access) — fall back to the
        // Team-scoped source: which of THIS caller's own managed Teams
        // (already fetched alongside `projects`) is attached to this
        // exact Project. Never an unrelated Team.
        setModalProjectTeamIds(managedTeamProjectMap[projectId] || []);
      });
    return () => { cancelled = true; };
  }, [formData.project_id, managedTeamProjectMap]);

  // Team Manager Create-Task-form follow-up: changing Project must
  // clear/revalidate an incompatible Team selection (which, via the
  // effect above, cascades into clearing an incompatible Assignee too).
  useEffect(() => {
    if (modalProjectTeamIds === null) return;
    setFormData((p) => (
      p.team_id && !modalProjectTeamIds.some((id) => String(id) === String(p.team_id))
        ? { ...p, team_id: "" }
        : p
    ));
  }, [modalProjectTeamIds]);

  // The classic modal's actual Team option source — every Team this actor
  // already has (unchanged) when no Project is selected yet, or hasn't
  // resolved a restriction; the Project-scoped intersection otherwise.
  const modalTeamOptions = modalProjectTeamIds === null
    ? teams
    : teams.filter((t) => modalProjectTeamIds.some((id) => String(id) === String(t.id)));

  // Inline-assignee-dropdown bug-fix follow-up: the INLINE quick-assignee
  // `<Select>` in the "All Tasks" table (unlike the Create/Edit modal
  // above, which only ever has one team_id active at a time) needs
  // options for however many DISTINCT teams are represented across every
  // currently-visible Team Task — ONE bulk request for all of them,
  // never one `getAssignableUsers()` call per row and never one per
  // unique team either. `assignableUsersByTeamId` stays keyed by team id
  // (as a string, matching the API's JSON keys) so each row looks up
  // only its own task.team_id's list — Technology Team tasks never see
  // Marketing's members and vice versa (see utils/taskAssignees.js's
  // getInlineAssigneeOptions()).
  const [assignableUsersByTeamId, setAssignableUsersByTeamId] = useState({});
  const [assignableUsersLoading, setAssignableUsersLoading] = useState(false);
  const visibleTeamIds = useMemo(() => {
    const ids = new Set();
    for (const t of myTasks) if (t.team_id != null) ids.add(t.team_id);
    for (const t of allTasks) if (t.team_id != null) ids.add(t.team_id);
    return Array.from(ids).sort((a, b) => a - b);
  }, [myTasks, allTasks]);
  const visibleTeamIdsKey = visibleTeamIds.join(",");

  useEffect(() => {
    Promise.resolve().then(async () => {
      if (!visibleTeamIds.length) {
        setAssignableUsersByTeamId({});
        return;
      }
      setAssignableUsersLoading(true);
      try {
        const data = await teamApi.getAssignableUsersBulk(visibleTeamIds);
        setAssignableUsersByTeamId(data?.teams || {});
      } catch {
        setAssignableUsersByTeamId({});
      } finally {
        setAssignableUsersLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTeamIdsKey]);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function updateTaskInLists(updated) {
    setMyTasks((p) => p.map((t) => (t.id === updated.id ? updated : t)));
    setAllTasks((p) => p.map((t) => (t.id === updated.id ? updated : t)));
  }

  function removeTaskFromLists(id) {
    setMyTasks((p) => p.filter((t) => t.id !== id));
    setAllTasks((p) => p.filter((t) => t.id !== id));
  }

  function getStatusOptionsForTask(task) {
    if (canEditTaskDetailsFor(task)) return STATUS_OPTIONS;
    if (task.status === "pending_review" || task.status === "done") return STATUS_OPTIONS.filter((o) => o.value === task.status);
    return TEAM_MEMBER_STATUS_OPTIONS;
  }

  // Assignee-safe status change: independent of role — a Team Manager
  // who is merely the assignee of a Task in a Team they don't manage
  // gets exactly the same assignee-safe status control a plain Team
  // Member would, never a hard "no access" just because their role
  // isn't literally team_member (see canFullyManageTask's own docstring
  // comment for the full precedence rationale).
  function canChangeStatus(task) {
    if (canEditTaskDetailsFor(task)) return true;
    return task.assignee_id === user?.id && task.status !== "pending_review" && task.status !== "done";
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  }

  function resetForm() {
    setFormData(initialForm);
    setEditingTaskId(null);
    setFormError("");
    // Create-modal state-isolation follow-up: never let a Team/Project
    // picked in one PM creation mode leak into the other, or into the
    // classic modal, on the next open.
    setPmCreateMode(null);
    setPmModalProjectTeams([]);
  }

  function openCreateModal() {
    resetForm();
    // Task ownership/default-assignee follow-up (UX): preselect the
    // current user as Assignee so a Team-less Task never LOOKS like it
    // can only be created Unassigned (the exact reported confusion — for
    // a Team Manager, GET /users 403s and `assignees` is empty, so the
    // dropdown previously showed nothing but "Unassigned"). This is a UX
    // default only — the backend independently defaults an omitted/null
    // assignee_id to the creator regardless of what this form shows (see
    // create_task's own docstring), and picking a Team below still
    // re-scopes this field to that Team's eligible members exactly as
    // before; Owner/Admin remain free to change it to anyone.
    setFormData((p) => ({ ...p, assignee_id: user?.id ? String(user.id) : "" }));
    setOpenMenuId(null);
    setIsModalOpen(true);
    // No specific task exists yet to be "this"/"it" — clear any stale
    // context left over from a previously-edited task.
    clearPageContext();
  }

  // Project Manager Task-delegation follow-up: `mode` is "self" (+ Add My
  // Task) or "project_team" (+ Add Project Task) — it only ever selects
  // which restricted FORM renders and which fixed invariant the submit
  // handler sends; it grants no privilege of its own; the backend
  // independently re-derives and enforces the same rule from the
  // authenticated actor's own capability, never trusting this UI state.
  function openPmCreateModal(mode) {
    resetForm();
    setPmCreateMode(mode);
    setOpenMenuId(null);
    setIsModalOpen(true);
    clearPageContext();
  }

  function closeModal() {
    resetForm();
    setIsModalOpen(false);
    // Architecture item 9 — validated UI/page context: the chat widget must
    // stop treating "this"/"it" as referring to a task the user is no
    // longer looking at once its edit modal closes.
    clearPageContext();
  }

  function handleEdit(task) {
    setOpenMenuId(null);
    setEditingTaskId(task.id);
    setFormData({
      name:        task.name || "",
      description: task.description || "",
      start_date:  task.start_date || "",
      due_date:    task.due_date || "",
      assignee_id: task.assignee_id ? String(task.assignee_id) : "",
      project_id:  task.project_id  ? String(task.project_id)  : "",
      team_id:     task.team_id     ? String(task.team_id)     : "",
      status:      task.status || "todo",
      priority:    task.priority || "medium",
    });
    setFormError("");
    setIsModalOpen(true);
    // Architecture item 9 — announce that the user is now looking at this
    // specific task, so "mark this done" in chat resolves to it.
    setPageContext("task", task.id);

    // Project Manager Task-update follow-up: the PM edit modal's Team
    // dropdown must only offer Teams already attached to THIS task's
    // Project (same rule the backend's `update_task` re-derives and
    // enforces independently via `list_project_team_ids` — this is just
    // the honest UI for it), never an arbitrary org team.
    if (isPlainProjectManager && task.project_id) {
      setIsPmModalTeamsLoading(true);
      projectApi.listItems(task.project_id)
        .then((items) => setPmModalProjectTeams(items?.teams || []))
        .catch(() => setPmModalProjectTeams([]))
        .finally(() => setIsPmModalTeamsLoading(false));
    } else if (isPlainProjectManager) {
      setPmModalProjectTeams([]);
    }
  }

  // Project Manager Task-update follow-up: the full task object behind
  // `editingTaskId` — needed to show the (read-only) current assignee's
  // name in the PM edit modal, which `formData` alone doesn't carry.
  const editingTask = useMemo(() => {
    if (editingTaskId === null) return null;
    return myTasks.find((t) => t.id === editingTaskId) || allTasks.find((t) => t.id === editingTaskId) || null;
  }, [editingTaskId, myTasks, allTasks]);

  async function handlePmEditSubmit(e) {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError("");
    try {
      // Strict whitelist matching the backend's PM_ALLOWED_TASK_UPDATE_FIELDS
      // — assignee_id and project_id are never candidates here at all, not
      // even the task's own current (unchanged) value, so a PM's PATCH can
      // never be mistaken for an assignment attempt. Personal-Task-edit-
      // payload follow-up: diffed against the task's own current values
      // like every other Edit Task path, so an unrelated no-op field never
      // rides along either.
      const candidates = {
        name:        formData.name,
        description: formData.description || null,
        start_date:  formData.start_date || null,
        due_date:    formData.due_date   || null,
        status:      formData.status,
        priority:    formData.priority,
        team_id:     formData.team_id ? Number(formData.team_id) : null,
      };
      const originals = {
        name:        editingTask?.name || "",
        description: editingTask?.description || null,
        start_date:  editingTask?.start_date || null,
        due_date:    editingTask?.due_date   || null,
        status:      editingTask?.status || "",
        priority:    editingTask?.priority || "",
        team_id:     editingTask?.team_id  ?? null,
      };
      const payload = {};
      for (const key of Object.keys(candidates)) {
        if (candidates[key] !== originals[key]) payload[key] = candidates[key];
      }
      const updated = Object.keys(payload).length > 0
        ? await taskApi.update(editingTaskId, payload)
        : editingTask;
      updateTaskInLists(updated);
      toast.success("Task updated.");
      closeModal();
    } catch (err) {
      setFormError(err.message || "Unable to save task.");
      toast.error(err.message || "Unable to save task.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError("");
    try {
      // Team Manager task-authority-precedence follow-up (defense in
      // depth): every UI entry point that could open this modal for a
      // Task this actor does NOT fully manage is already gated out
      // (My Tasks table/card/calendar all use canFullyManageTask/
      // canEditTaskDetailsFor per task) — this modal should never
      // actually be reached for such a Task. If it somehow is anyway,
      // never submit more than the backend's own assignee-safe field
      // whitelist would accept; sending the full payload would just be
      // rejected, matching backend precedence instead of trusting the
      // UI path that got us here.
      const payload = (isEditing && !canFullyManageTask(editingTask))
        ? { status: formData.status }
        : isEditing
        // Personal-Task-edit-payload follow-up: an EDIT must only submit
        // fields the user actually changed from the task's own current
        // values — never re-send every field verbatim (see
        // buildChangedTaskFields's own docstring for why this matters:
        // a Personal Task owner's PATCH is field-whitelisted server-side,
        // and `assignee_id` is deliberately NOT in that whitelist even
        // when the value would be a no-op).
        ? buildChangedTaskFields(editingTask, formData)
        : {
            name:        formData.name,
            description: formData.description || null,
            start_date:  formData.start_date || null,
            due_date:    formData.due_date   || null,
            // Leave unassigned to land the task in the team's To-Do list instead.
            assignee_id: formData.assignee_id ? Number(formData.assignee_id) : null,
            project_id:  formData.project_id  ? Number(formData.project_id)  : null,
            team_id:     formData.team_id     ? Number(formData.team_id)     : null,
            status:      formData.status,
            priority:    formData.priority,
          };

      if (isEditing) {
        const updated = Object.keys(payload).length > 0
          ? await taskApi.update(editingTaskId, payload)
          : editingTask;
        updateTaskInLists(updated);
        toast.success("Task updated.");
      } else {
        const created = await taskApi.create(payload);
        if (created.assignee_id === user?.id) setMyTasks((p) => [created, ...p]);
        setAllTasks((p) => [created, ...p]);
        toast.success("Task created.");
      }
      closeModal();
    } catch (err) {
      setFormError(err.message || "Unable to save task.");
      toast.error(err.message || "Unable to save task.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Project Manager Task-delegation follow-up: Project → Team cascade.
  // Only relevant to the "project_team" PM mode — refetches this exact
  // Project's attached Teams (the same GET /projects/{id}/items a
  // Project Manager already has legitimate read access to; never
  // GET /teams, which is empty for a plain PM) every time the selected
  // Project changes, and clears any Team selection that doesn't belong
  // to the new Project — never silently carries a Team over from the
  // previous Project.
  useEffect(() => {
    // Skip entirely while editing an existing task — handleEdit already
    // loads this task's project-scoped Teams itself (the task's project
    // never changes during a PM edit, since project_id isn't one of the
    // fields this form lets a PM touch), so this effect would otherwise
    // immediately clear that result right after it loads.
    if (isEditing || pmCreateMode !== "project_team" || !formData.project_id) {
      if (!isEditing) setPmModalProjectTeams([]);
      return;
    }
    let cancelled = false;
    setIsPmModalTeamsLoading(true);
    projectApi.listItems(formData.project_id)
      .then((items) => {
        if (cancelled) return;
        const projectTeamOptions = items?.teams || [];
        setPmModalProjectTeams(projectTeamOptions);
        setFormData((current) => {
          if (current.team_id && !projectTeamOptions.some((t) => String(t.id) === String(current.team_id))) {
            return { ...current, team_id: "" };
          }
          return current;
        });
      })
      .catch(() => {
        if (!cancelled) setPmModalProjectTeams([]);
      })
      .finally(() => {
        if (!cancelled) setIsPmModalTeamsLoading(false);
      });
    return () => { cancelled = true; };
  }, [pmCreateMode, formData.project_id]);

  async function handlePmSubmit(e) {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError("");
    try {
      const basePayload = {
        name:        formData.name,
        description: formData.description || null,
        start_date:  formData.start_date || null,
        due_date:    formData.due_date   || null,
        project_id:  formData.project_id ? Number(formData.project_id) : null,
        priority:    formData.priority,
      };
      // The backend independently enforces both invariants below
      // (create_task's is_plain_project_manager branch) — this is not
      // the security boundary, just the honest request a correctly-built
      // UI sends for each mode.
      const payload = pmCreateMode === "self"
        ? { ...basePayload, team_id: null, assignee_id: user?.id ? Number(user.id) : null }
        : { ...basePayload, team_id: formData.team_id ? Number(formData.team_id) : null, assignee_id: null };

      const created = await taskApi.create(payload);
      if (created.assignee_id === user?.id) setMyTasks((p) => [created, ...p]);
      setAllTasks((p) => [created, ...p]);
      toast.success(pmCreateMode === "self" ? "Task created." : "Project task created and delegated to the team.");
      closeModal();
    } catch (err) {
      setFormError(err.message || "Unable to save task.");
      toast.error(err.message || "Unable to save task.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(task) {
    setOpenMenuId(null);
    if (!(await confirm({ message: `Delete "${task.name}"?`, tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await taskApi.delete(task.id);
      removeTaskFromLists(task.id);
      if (editingTaskId === task.id) closeModal();
      toast.success("Task deleted.");
    } catch (err) {
      toast.error(err.message || "Unable to delete task.");
    }
  }

  async function quickStatusUpdate(task, newStatus) {
    // Team Manager Task-update-scope bug fix / duplicate-request follow-up:
    // `pendingTaskIds` is the actual guard against a double-fire for this
    // exact task (a second click, or the same task rendered in both the
    // My Tasks and All Tasks sections at once, sharing this one Set keyed
    // by task.id) — it disables both rendered controls for this task id
    // the instant the first request starts, so at most one PATCH is ever
    // in flight per task. This early return is that guard, not a cosmetic
    // debounce.
    if (pendingTaskIds.has(task.id)) return;
    setOpenMenuId(null);
    markTaskPending(task.id, true);
    // A stable per-task toast id: if a duplicate-toast path is ever
    // reintroduced (or the two list sections above both attempt the same
    // change), react-hot-toast replaces the existing toast with this id
    // instead of stacking a second one — the underlying request is still
    // deduplicated by pendingTaskIds above; this only guarantees the UI
    // never SHOWS two notifications for what is, at most, one real
    // network request.
    const toastId = `task-status-${task.id}`;
    try {
      // Project Manager Task-update follow-up: PATCH /tasks/{id}/status
      // (`update_task_status`) used to have its own bespoke, narrower
      // authorization (only TEAM_MEMBER self-service or Owner/Admin) —
      // now fixed to share the same canonical `require_task_update_access`
      // gate `PATCH /tasks/{id}` uses (Team Manager scoped to a Team they
      // manage, the actual assignee, Owner/Admin, or a Project-Manager-
      // scoped Project member), so every role's quick status change can
      // go through `updateStatus` again. A plain Project Manager still
      // routes through `update()` here — `update_task_status` was never
      // extended with PM's own field-whitelist/Done semantics, and
      // `update_task` already implements and tests those identically, so
      // duplicating them into the status endpoint would just be a second,
      // parallel implementation of the same rule.
      const updated = isPlainProjectManager
        ? await taskApi.update(task.id, { status: newStatus })
        : await taskApi.updateStatus(task.id, newStatus);
      updateTaskInLists(updated);
      if (updated.status === "done") {
        const isSelf = task.assignee_id === user?.id;
        setCelebrationData({ taskName: updated.name, completedByName: isSelf ? null : (task.assignee?.full_name || null) });
      } else {
        toast.success("Status updated.", { id: toastId });
      }
    } catch (err) {
      toast.error(err.message || "Unable to update status.", { id: toastId });
    } finally {
      markTaskPending(task.id, false);
    }
  }

  async function quickPriorityUpdate(task, newPriority) {
    if (pendingTaskIds.has(task.id)) return;
    markTaskPending(task.id, true);
    try {
      const updated = await taskApi.update(task.id, { priority: newPriority });
      updateTaskInLists(updated);
      toast.success("Priority updated.");
    } catch (err) {
      toast.error(err.message || "Unable to update priority.");
    } finally {
      markTaskPending(task.id, false);
    }
  }

  // Project Manager Task-update follow-up: Start/Due Date inline editors —
  // both fields are on `PM_ALLOWED_TASK_UPDATE_FIELDS`, so this is just
  // `taskApi.update()` with a single field, same as priority above.
  async function quickDateUpdate(task, field, newValue) {
    if (pendingTaskIds.has(task.id)) return;
    markTaskPending(task.id, true);
    try {
      const updated = await taskApi.update(task.id, { [field]: newValue || null });
      updateTaskInLists(updated);
      toast.success(field === "start_date" ? "Start date updated." : "Due date updated.");
    } catch (err) {
      toast.error(err.message || "Unable to update date.");
    } finally {
      markTaskPending(task.id, false);
    }
  }

  async function quickAssigneeUpdate(task, newAssigneeId) {
    if (pendingTaskIds.has(task.id)) return;
    markTaskPending(task.id, true);
    try {
      const updated = await taskApi.update(task.id, { assignee_id: newAssigneeId ? Number(newAssigneeId) : null });
      updateTaskInLists(updated);
      toast.success("Assignee updated.");
    } catch (err) {
      toast.error(err.message || "Unable to update assignee.");
    } finally {
      markTaskPending(task.id, false);
    }
  }

  async function approveTask(task) {
    setReviewActionId(task.id);
    setOpenMenuId(null);
    try {
      const updated = await taskApi.approve(task.id);
      updateTaskInLists(updated);
      setCelebrationData({ taskName: updated.name, completedByName: task.assignee?.full_name || null });
    } catch (err) {
      toast.error(err.message || "Unable to approve task.");
    } finally {
      setReviewActionId(null);
    }
  }

  async function assignBackTask(task) {
    const note = await prompt({
      title: "Assign Back",
      message: "Reason for assigning back (optional):",
      confirmLabel: "Assign Back",
      multiline: true,
    });
    if (note === null) return;
    setReviewActionId(task.id);
    setOpenMenuId(null);
    try {
      const updated = await taskApi.assignBack(task.id, { note: note || "Assigned back for more work." });
      updateTaskInLists(updated);
      toast.success("Task assigned back.");
    } catch (err) {
      toast.error(err.message || "Unable to assign back.");
    } finally {
      setReviewActionId(null);
    }
  }

  // ─── My Tasks filter change ──────────────────────────────────────────────────
  function setMyFilter(key, val) { setMyFilters((p) => ({ ...p, [key]: val })); }
  function resetMyFilters() { setMyFilters({ search: "", status: "all", priority: "all", overdue: false }); }
  const myFiltersActive = myFilters.search || myFilters.status !== "all" || myFilters.priority !== "all" || myFilters.overdue;

  // ─── All Tasks filter change ─────────────────────────────────────────────────
  function setAllFilter(key, val) { setAllFilters((p) => ({ ...p, [key]: val })); }
  function resetAllFilters() {
    setAllFilters({ search: "", status: "all", priority: "all", assignee: "all", project: "all", team: "all", overdue: false, dueDateFrom: "", dueDateTo: "" });
  }
  const allFiltersActive = allFilters.search || allFilters.status !== "all" || allFilters.priority !== "all" ||
    allFilters.assignee !== "all" || allFilters.project !== "all" || allFilters.team !== "all" ||
    allFilters.overdue || allFilters.dueDateFrom || allFilters.dueDateTo;

  // Project Manager "All Tasks" follow-up (Phase 20): a plain Project
  // Manager's All Tasks empty state should read as project-scoped, not
  // the generic Owner/Admin/Team Manager "create one" copy (a PM has no
  // Add Task entry point on this tab), and never My Tasks' "assigned to
  // you" wording either.
  const allTasksEmptyMessage = allFiltersActive
    ? "No tasks match your filters."
    : (canManageTasks ? "No tasks yet. Create one above." : "No tasks found in your projects.");

  // ─── Menu helpers ────────────────────────────────────────────────────────────

  function handleMenuToggle(e, taskId) {
    e.stopPropagation();
    if (openMenuId === taskId) {
      setOpenMenuId(null);
      setMenuPos(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
      setOpenMenuId(taskId);
    }
  }

  const openMenuTask = useMemo(() => {
    if (!openMenuId) return null;
    return myTasks.find((t) => t.id === openMenuId) || allTasks.find((t) => t.id === openMenuId) || null;
  }, [openMenuId, myTasks, allTasks]);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => { setOpenMenuId(null); setMenuPos(null); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuId]);

  // ─── Tabs ────────────────────────────────────────────────────────────────────

  const primaryTabs = [
    { key: "my_tasks",  label: "My Tasks"  },
    ...(canViewAllTasksTab ? [{ key: "all_tasks", label: "All Tasks" }] : []),
  ];

  const viewModes = [
    { key: "list",     label: "List"     },
    { key: "board",    label: "Board"    },
    { key: "calendar", label: "Calendar" },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="w-full">
      {/* Page header */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Tasks</h1>
          <p className="mt-1 text-sm text-slate-500">Create, assign, and track project tasks.</p>
        </div>
        {canManageTasks ? (
          <button type="button" onClick={openCreateModal}
            className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            + Add Task
          </button>
        ) : isPlainProjectManager ? (
          // Project Manager Task-delegation follow-up: this action is
          // page-level — it stays visible across List/Board/Calendar
          // (unaffected by `viewMode`) and only its label/mode switches
          // with the active primary tab.
          primaryTab === "my_tasks" ? (
            <button type="button" onClick={() => openPmCreateModal("self")}
              className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
              + Add My Task
            </button>
          ) : (
            <button type="button" onClick={() => openPmCreateModal("project_team")}
              className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
              + Add Project Task
            </button>
          )
        ) : null}
      </div>

      {/* Primary tabs */}
      <div className="mb-6 border-b border-slate-200">
        <nav className="flex gap-1">
          {primaryTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => { setPrimaryTab(tab.key); setOpenMenuId(null); }}
              className={
                primaryTab === tab.key
                  ? "border-b-2 border-slate-900 px-4 pb-3 pt-1 text-sm font-semibold text-slate-900"
                  : "px-4 pb-3 pt-1 text-sm font-semibold text-slate-500 hover:text-slate-900"
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── MY TASKS ─────────────────────────────────────────────────────────── */}
      {primaryTab === "my_tasks" && (
        <>
          {/* View mode toggle */}
          <div className="mb-5 flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm w-fit">
            {viewModes.map((vm) => (
              <button
                key={vm.key}
                type="button"
                onClick={() => setMyViewMode(vm.key)}
                className={
                  myViewMode === vm.key
                    ? "rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white"
                    : "rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900"
                }
              >
                {vm.label}
              </button>
            ))}
          </div>

          {/* ── LIST ── */}
          {myViewMode === "list" && (
            <>
              <FiltersBar
                filters={myFilters}
                onChange={setMyFilter}
                onReset={resetMyFilters}
                isActive={myFiltersActive}
              />

              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  Showing <span className="font-semibold text-slate-900">{filteredMyTasks.length}</span> of{" "}
                  <span className="font-semibold text-slate-900">{myTasks.length}</span> tasks
                </p>
                <button type="button" onClick={loadMyTasks}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  Refresh
                </button>
              </div>

              {myTasksLoading ? (
                <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading your tasks…</div>
              ) : myTasksError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{myTasksError}</div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1220px] text-sm">
                        <thead className="bg-slate-50">
                          <tr className="border-b border-slate-200">
                            <th className="w-10 px-4 py-3" />
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Task Name</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Priority</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Project</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Team</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Start Date</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Due Date</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Working Time</th>
                            <th className="px-4 py-3 text-right font-semibold text-slate-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {filteredMyTasks.length ? filteredMyTasks.map((task) => (
                            <tr key={task.id} className={getDueRowClassName(task)}>
                              <td className="px-4 py-4 align-middle">
                                <button type="button"
                                  disabled={pendingTaskIds.has(task.id) || task.status === "pending_review"}
                                  onClick={() => quickStatusUpdate(task, task.status === "done" ? "todo" : "done")}
                                  className={
                                    task.status === "done"
                                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs text-white"
                                      : task.status === "pending_review"
                                      ? "flex h-5 w-5 cursor-not-allowed items-center justify-center rounded-full border border-amber-400 text-amber-500"
                                      : "flex h-5 w-5 items-center justify-center rounded-full border border-slate-400 text-slate-400 hover:border-slate-900"
                                  }>✓</button>
                              </td>
                              <td className="px-4 py-4 align-middle">
                                <span className={task.status === "done" ? "font-medium text-slate-400 line-through" : "font-medium text-slate-900"}>
                                  {task.name}
                                </span>
                                {task.review_note && <p className="mt-1 text-xs text-amber-600">Note: {task.review_note}</p>}
                              </td>
                              <td className="px-4 py-4 align-middle">
                                {canEditTaskDetailsFor(task) ? (
                                  <Select value={task.priority || "medium"} disabled={pendingTaskIds.has(task.id)} onChange={(e) => quickPriorityUpdate(task, e.target.value)}
                                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold capitalize text-slate-700 focus:border-slate-900 focus:outline-none">
                                    {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </Select>
                                ) : (
                                  <PriorityBadge priority={task.priority} />
                                )}
                              </td>
                              <td className="px-4 py-4 align-middle text-slate-700">{task.project?.name || "—"}</td>
                              <td className="px-4 py-4 align-middle text-slate-700">{task.team?.name || "—"}</td>
                              <td className="px-4 py-4 align-middle text-slate-700">
                                {canEditTaskDetailsFor(task) ? (
                                  <DatePicker
                                    value={task.start_date || ""}
                                    disabled={pendingTaskIds.has(task.id)}
                                    onChange={(e) => quickDateUpdate(task, "start_date", e.target.value)}
                                  />
                                ) : task.start_date ? formatDate(task.start_date) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-4 align-middle">
                                {canEditTaskDetailsFor(task) ? (
                                  <DatePicker
                                    value={task.due_date || ""}
                                    disabled={pendingTaskIds.has(task.id)}
                                    onChange={(e) => quickDateUpdate(task, "due_date", e.target.value)}
                                  />
                                ) : (
                                  <DueDateCell task={task} />
                                )}
                              </td>
                              <td className="px-4 py-4 align-middle">
                                {canChangeStatus(task) ? (
                                  <Select value={task.status} disabled={pendingTaskIds.has(task.id)} onChange={(e) => quickStatusUpdate(task, e.target.value)}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none">
                                    {getStatusOptionsForTask(task).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </Select>
                                ) : (
                                  <StatusBadge status={task.status} />
                                )}
                              </td>
                              <td className="px-4 py-4 align-middle">
                                <WorkingTimeCell
                                  taskId={task.id}
                                  workingTimeSeconds={taskWorkingTimes[task.id]?.working_time_seconds}
                                  activeTimerCount={taskWorkingTimes[task.id]?.active_timer_count}
                                  currentUserIsActive={Boolean(taskWorkingTimes[task.id]?.current_user_is_active)}
                                  currentUserHasActiveTimerElsewhere={currentUserHasActiveTimer && !taskWorkingTimes[task.id]?.current_user_is_active}
                                  canControlTimer={task.assignee_id != null && task.assignee_id === user?.id}
                                  onTimeChange={refreshTaskWorkingTimes}
                                />
                              </td>
                              <td className="px-4 py-4 text-right align-middle">
                                {canEditTaskDetailsFor(task) ? (
                                  canFullyManageTask(task) && task.status === "pending_review" ? (
                                    <div className="flex justify-end gap-2">
                                      <button type="button" onClick={() => approveTask(task)} disabled={reviewActionId === task.id}
                                        className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60">
                                        Approve
                                      </button>
                                      <button type="button" onClick={() => assignBackTask(task)} disabled={reviewActionId === task.id}
                                        className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60">
                                        Assign Back
                                      </button>
                                    </div>
                                  ) : (
                                    // A plain Project Manager joins this same
                                    // kebab menu — the shared fixed-position
                                    // dropdown only ever offers this actor
                                    // "Edit Task" (never Delete).
                                    <button type="button" onClick={(e) => handleMenuToggle(e, task.id)} aria-label="Task actions"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                                      <ThreeDotsIcon />
                                    </button>
                                  )
                                ) : null}
                              </td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={10}>
                                <EmptyState message={myFiltersActive ? "No tasks match your filters." : "No tasks assigned to you yet."} />
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mobile cards */}
                  <div className="space-y-3 md:hidden">
                    {filteredMyTasks.length ? filteredMyTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        canManageTasks={false}
                        canEditTaskDetails={canEditTaskDetailsFor(task)}
                        isTeamMember={isTeamMember}
                        user={user}
                        onEdit={handleEdit}
                        onStatusChange={quickStatusUpdate}
                        onApprove={approveTask}
                        onAssignBack={assignBackTask}
                        reviewActionTaskId={reviewActionId}
                        workingTime={taskWorkingTimes[task.id]}
                        currentUserHasActiveTimer={currentUserHasActiveTimer}
                        onTimeChange={refreshTaskWorkingTimes}
                      />
                    )) : (
                      <EmptyState message={myFiltersActive ? "No tasks match your filters." : "No tasks assigned to you yet."} />
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── BOARD ── */}
          {myViewMode === "board" && (
            myTasksLoading ? (
              <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading…</div>
            ) : (
              <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {STATUS_OPTIONS.map((s) => (
                  <div key={s.value} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h2 className="mb-4 text-sm font-semibold text-slate-700">
                      {s.label}
                      <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                        {groupedMyByStatus[s.value]?.length || 0}
                      </span>
                    </h2>
                    <div className="space-y-3">
                      {groupedMyByStatus[s.value]?.map((task) => (
                        <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <h3 className={task.status === "done" ? "text-sm font-medium text-slate-400 line-through" : "text-sm font-medium text-slate-900"}>
                            {task.name}
                          </h3>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <StatusBadge status={task.status} />
                            <PriorityBadge priority={task.priority} />
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Project: {task.project?.name || "—"}</p>
                          <p className="mt-1 text-xs text-slate-500">Team: {task.team?.name || "—"}</p>
                          <p className="mt-1 text-xs"><DueDateCell task={task} /></p>
                          {task.review_note && (
                            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.review_note}</p>
                          )}
                          {canChangeStatus(task) && task.status !== "pending_review" && task.status !== "done" && (
                            <div className="mt-3">
                              <Select value={task.status} onChange={(e) => quickStatusUpdate(task, e.target.value)}
                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-slate-900 focus:outline-none">
                                {getStatusOptionsForTask(task).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </Select>
                            </div>
                          )}
                        </div>
                      ))}
                      {!groupedMyByStatus[s.value]?.length && (
                        <p className="rounded-xl bg-white px-4 py-5 text-sm text-slate-400">No tasks here.</p>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            )
          )}

          {/* ── CALENDAR ── */}
          {myViewMode === "calendar" && (
            <TaskCalendar
              tasks={filteredMyTasks}
              filtersActive={myFiltersActive}
              // My Tasks is visible to every role (Team Member/Client
              // included), unlike All Tasks below — only pass a click
              // handler when this actor actually has an Edit Task entry
              // point elsewhere on this page (List/Board already agree:
              // neither gives a plain Team Member/Client one either).
              // Team Manager task-authority-precedence follow-up:
              // `canClickTask` narrows this PER TASK — a Team Manager's
              // My Tasks can include a Task from a Team they don't
              // manage (see canFullyManageTask's own comment), which
              // must open no editor here either, matching List/Board's
              // identical rule.
              onTaskClick={handleEdit}
              canClickTask={(task) => canFullyManageTask(task) || isPlainProjectManager}
            />
          )}
        </>
      )}

      {/* ── ALL TASKS ────────────────────────────────────────────────────────── */}
      {primaryTab === "all_tasks" && canViewAllTasksTab && (
        <>
          {/* View mode toggle (List / Board / Calendar) */}
          <div className="mb-5 flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm w-fit">
            {viewModes.map((vm) => (
              <button
                key={vm.key}
                type="button"
                onClick={() => setViewMode(vm.key)}
                className={
                  viewMode === vm.key
                    ? "rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white"
                    : "rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900"
                }
              >
                {vm.label}
              </button>
            ))}
          </div>

          {viewMode === "list" && (
            <>
              <FiltersBar
                filters={allFilters}
                onChange={setAllFilter}
                onReset={resetAllFilters}
                isActive={allFiltersActive}
                extraFilters={
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Assignee</label>
                      <Select value={allFilters.assignee} onChange={(e) => setAllFilter("assignee", e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-900">
                        <option value="all">All assignees</option>
                        {assigneeOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Project</label>
                      <Select value={allFilters.project} onChange={(e) => setAllFilter("project", e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-900">
                        <option value="all">All projects</option>
                        {projectOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Team</label>
                      <Select value={allFilters.team} onChange={(e) => setAllFilter("team", e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-900">
                        <option value="all">All teams</option>
                        {teamOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Due From</label>
                      <DatePicker value={allFilters.dueDateFrom} onChange={(e) => setAllFilter("dueDateFrom", e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Due To</label>
                      <DatePicker value={allFilters.dueDateTo} onChange={(e) => setAllFilter("dueDateTo", e.target.value)} />
                    </div>
                  </>
                }
              />

              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  Showing <span className="font-semibold text-slate-900">{filteredAllTasks.length}</span> of{" "}
                  <span className="font-semibold text-slate-900">{allTasks.length}</span> tasks
                </p>
                <button type="button" onClick={loadAllTasks}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  Refresh
                </button>
              </div>

              {allTasksLoading ? (
                <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading tasks…</div>
              ) : allTasksError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{allTasksError}</div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1220px] text-sm">
                        <thead className="bg-slate-50">
                          <tr className="border-b border-slate-200">
                            <th className="w-10 px-4 py-3" />
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Task Name</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Priority</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Project</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Assignee</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Team</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Start Date</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Due Date</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-700">Working Time</th>
                            <th className="px-4 py-3 text-right font-semibold text-slate-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {filteredAllTasks.length ? filteredAllTasks.map((task) => (
                            <TaskTableRow
                              key={task.id}
                              task={task}
                              reviewActionId={reviewActionId}
                              canManageTasks={canManageTasks}
                              canEditTaskDetails={canEditTaskDetails}
                              isTeamMember={isTeamMember}
                              userId={user?.id}
                              assignees={assignees}
                              onQuickStatus={quickStatusUpdate}
                              onQuickPriority={quickPriorityUpdate}
                              onQuickAssignee={quickAssigneeUpdate}
                              onQuickDate={quickDateUpdate}
                              onApprove={approveTask}
                              onAssignBack={assignBackTask}
                              onToggleMenu={handleMenuToggle}
                              isPending={pendingTaskIds.has(task.id)}
                              workingTime={taskWorkingTimes[task.id]}
                              currentUserHasActiveTimer={currentUserHasActiveTimer}
                              onTimeChange={refreshTaskWorkingTimes}
                              assignableUsersByTeamId={assignableUsersByTeamId}
                              assignableUsersLoading={assignableUsersLoading}
                            />
                          )) : (
                            <tr>
                              <td colSpan={11}>
                                <EmptyState message={allTasksEmptyMessage} />
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mobile cards */}
                  <div className="space-y-3 md:hidden">
                    {filteredAllTasks.length ? filteredAllTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        canManageTasks={canManageTasks}
                        canEditTaskDetails={canEditTaskDetails}
                        isTeamMember={isTeamMember}
                        user={user}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onStatusChange={quickStatusUpdate}
                        onApprove={approveTask}
                        onAssignBack={assignBackTask}
                        reviewActionTaskId={reviewActionId}
                        workingTime={taskWorkingTimes[task.id]}
                        currentUserHasActiveTimer={currentUserHasActiveTimer}
                        onTimeChange={refreshTaskWorkingTimes}
                      />
                    )) : (
                      <EmptyState message={allTasksEmptyMessage} />
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── BOARD view ─────────────────────────────────────────────────── */}
          {viewMode === "board" && (
            allTasksLoading ? (
              <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading…</div>
            ) : (
              <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {STATUS_OPTIONS.map((s) => (
                  <div key={s.value} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h2 className="mb-4 text-sm font-semibold text-slate-700">
                      {s.label}
                      <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                        {groupedByStatus[s.value]?.length || 0}
                      </span>
                    </h2>
                    <div className="space-y-3">
                      {groupedByStatus[s.value]?.map((task) => (
                        <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className={task.status === "done" ? "text-sm font-medium text-slate-400 line-through" : "text-sm font-medium text-slate-900"}>
                              {task.name}
                            </h3>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <StatusBadge status={task.status} />
                            <PriorityBadge priority={task.priority} />
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Project: {task.project?.name || "—"}</p>
                          <p className="mt-1 text-xs text-slate-500">Assignee: {task.assignee?.full_name || "Unassigned"}</p>
                          <p className="mt-1 text-xs text-slate-500">Team: {task.team?.name || "—"}</p>
                          <p className="mt-1 text-xs"><DueDateCell task={task} /></p>
                          {task.review_note && (
                            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.review_note}</p>
                          )}
                          {task.status === "pending_review" ? (
                            <div className="mt-3 flex gap-2">
                              <button type="button" onClick={() => approveTask(task)} disabled={reviewActionId === task.id}
                                className="flex-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60">
                                Approve
                              </button>
                              <button type="button" onClick={() => assignBackTask(task)} disabled={reviewActionId === task.id}
                                className="flex-1 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60">
                                Assign Back
                              </button>
                            </div>
                          ) : (
                            <div className="mt-3 flex gap-2">
                              <button type="button" onClick={() => handleEdit(task)}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                                Edit
                              </button>
                              <button type="button" onClick={() => handleDelete(task)}
                                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {!groupedByStatus[s.value]?.length && (
                        <p className="rounded-xl bg-white px-4 py-5 text-sm text-slate-400">No tasks here.</p>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            )
          )}

          {/* ── CALENDAR view ──────────────────────────────────────────────── */}
          {viewMode === "calendar" && (
            <TaskCalendar tasks={filteredAllTasks} filtersActive={allFiltersActive} onTaskClick={handleEdit} />
          )}
        </>
      )}

      {/* Fixed-position three-dot dropdown — escapes overflow:hidden clipping */}
      {openMenuTask && menuPos && (
        <div
          className="fixed z-50 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          style={{ top: menuPos.top, right: menuPos.right }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { setMenuPos(null); handleEdit(openMenuTask); }}
            className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50">
            Edit Task
          </button>
          {/* Project Manager Actions-menu follow-up: a plain PM joins this
              exact menu (never a second one) but never gets Delete —
              DELETE /tasks/{id} stays Owner/Admin/Team-Manager only,
              unchanged; offering it here would just 403. Team Manager
              task-authority-precedence follow-up: PER TASK, not blanket
              — a Team Manager who merely happens to be this Task's
              assignee (not its Team's manager) must not see Delete. */}
          {canFullyManageTask(openMenuTask) && (
            <button type="button" onClick={() => { setMenuPos(null); handleDelete(openMenuTask); }}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50">
              Delete
            </button>
          )}
        </div>
      )}

      {/* Celebration overlay */}
      {celebrationData && (
        <CelebrationOverlay
          taskName={celebrationData.taskName}
          completedByName={celebrationData.completedByName}
          onDismiss={() => setCelebrationData(null)}
        />
      )}

      {/* ── Task modal ───────────────────────────────────────────────────────── */}
      {canManageTasks && isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{isEditing ? "Edit Task" : "Create Task"}</h2>
                <p className="mt-1 text-sm text-slate-500">{isEditing ? "Update this task's details." : "Create a new task. A team can be assigned now or later."}</p>
              </div>
              <button type="button" onClick={closeModal}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            {formError && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Task name *</label>
                <input name="name" value={formData.name} onChange={handleChange} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange}
                  rows={4} placeholder="Add task details..."
                  className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400" />
              </div>

              {/* Time tracking only applies to a task that already exists —
                  nothing to start a timer on until Create Task is saved. */}
              {isEditing && <TaskTimeTracker taskId={editingTaskId} onTimeChange={refreshTaskWorkingTimes} />}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Project</label>
                <Select name="project_id" value={formData.project_id} onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">No project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>

              {/* Team Manager Create-Task-form follow-up: narrowed to the
                  selected Project's attached Teams once one is picked
                  (Owner/Admin: that Project's real attached Teams via GET
                  /projects/{id}/items; a plain Team Manager: the subset of
                  THEIR OWN managed Teams attached to it) — every Team this
                  actor already has otherwise. */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Team</label>
                <Select name="team_id" value={formData.team_id} onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">Select team</option>
                  {modalTeamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </div>

              {/* Personal Task Assignee UX follow-up: editing your OWN
                  Personal Task (team_id NULL, you ARE the assignee) shows
                  a fixed, read-only "Assigned to you" indicator instead of
                  an editable dropdown — you already own this Task; there
                  is nothing to reassign, and the backend never accepts
                  `assignee_id` on this actor's PATCH regardless (see
                  buildChangedTaskFields). This also closes off the
                  Personal-Task-owner -> Team transition bypass: since this
                  field can't be touched here, picking a Team in the same
                  request can never double as picking an arbitrary member
                  through the weaker personal-owner permission tier.

                  Edit-Task-flow follow-up: this only holds while the DRAFT
                  team (`formData.team_id`), not the persisted original, is
                  still empty. The instant the Team Manager picks one of
                  their managed Teams here, the Assignee field becomes the
                  same editable, Team-scoped dropdown below IN THE SAME
                  MODAL — `modalAssignees`/`teamAssignableUsers` already
                  react to `formData.team_id` (see that effect), so no
                  extra request or Save-then-reopen is needed. The backend
                  independently re-verifies the caller actually manages
                  that exact target team before accepting `assignee_id`
                  alongside `team_id` — this is UX only, never the security
                  boundary. */}
              {isEditing && isPersonalTaskOwner(editingTask) && !formData.team_id ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Assignee</label>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    Assigned to you
                  </p>
                </div>
              ) : canManageTasks && (
                // Managers/admins can assign a task directly on creation, not
                // just when editing — leave unassigned to land it in the
                // team's To-Do list instead. Assigning to yourself is just
                // picking your own name here, same as anyone else. Defaults
                // to Unassigned, and is scoped to the selected Team's
                // eligible members once one is picked (see modalAssignees).
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Assignee</label>
                  <Select
                    name="assignee_id"
                    value={formData.assignee_id}
                    onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {modalAssignees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.id === user?.id ? "Assign to me" : a.role ? `${a.full_name} — ${a.role}` : a.full_name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Priority</label>
                  <Select name="priority" value={formData.priority} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                  <Select name="status" value={formData.status} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Start date</label>
                  <DatePicker name="start_date" value={formData.start_date} onChange={handleChange} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Due date</label>
                  <DatePicker name="due_date" value={formData.due_date} onChange={handleChange} />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {isSubmitting ? "Saving…" : isEditing ? "Update Task" : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project Manager Task-delegation follow-up: two intentionally
          SEPARATE, restricted create forms — never the classic modal
          above (that one stays Owner/Admin/Team-Manager only, unchanged).
          Neither form exposes an individual-assignee control at all; the
          backend independently re-derives and enforces the same
          invariant regardless of what this UI sends. */}
      {isPlainProjectManager && isModalOpen && pmCreateMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {pmCreateMode === "self" ? "Create My Task" : "Create Project Task"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {pmCreateMode === "self"
                    ? "Personal work you'll do yourself — optionally under one of your projects."
                    : "Delegate work to a team on one of your projects — the team's manager assigns the individual owner."}
                </p>
              </div>
              <button type="button" onClick={closeModal}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            {formError && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            )}

            <form onSubmit={handlePmSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Task name *</label>
                <input name="name" value={formData.name} onChange={handleChange} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange}
                  rows={4} placeholder="Add task details..."
                  className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400" />
              </div>

              <div>
                {/* Personal Task follow-up: Project is only mandatory when
                    delegating to a Team ("project_team" mode) — the
                    delegation's authorization scope originates entirely
                    from the Project. In "self" mode this is the PM's own
                    Personal/Standalone Task, which needs no Project anchor
                    at all (mirrors every other role's Personal Task); the
                    backend's own `create_task` only requires project_id
                    when team_id is set, so this form must not be stricter
                    than the API it calls. */}
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Project{pmCreateMode === "project_team" ? " *" : ""}
                </label>
                <Select name="project_id" value={formData.project_id} onChange={handleChange}
                  required={pmCreateMode === "project_team"}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">{pmCreateMode === "self" ? "No project (personal task)" : "Select project"}</option>
                  {/* Project options are already scoped to exactly the
                      Projects this Project Manager manages
                      (ProjectMembership) — GET /projects returns only
                      those for a plain PM; never org-wide. */}
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>

              {pmCreateMode === "project_team" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Team *</label>
                  {!formData.project_id ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400">
                      Select a project first.
                    </p>
                  ) : isPmModalTeamsLoading ? (
                    <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400">
                      Loading teams…
                    </p>
                  ) : pmModalProjectTeams.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                      No teams are assigned to this project.
                    </p>
                  ) : (
                    <Select name="team_id" value={formData.team_id} onChange={handleChange} required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                      <option value="">Select team</option>
                      {pmModalProjectTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Select>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    Only teams attached to the selected project — the team's manager will assign the individual owner.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Assignee</label>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    You ({user?.full_name || "me"})
                  </p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Priority</label>
                  <Select name="priority" value={formData.priority} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                <div />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Start date</label>
                  <DatePicker name="start_date" value={formData.start_date} onChange={handleChange} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Due date</label>
                  <DatePicker name="due_date" value={formData.due_date} onChange={handleChange} />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || (pmCreateMode === "project_team" && (!formData.project_id || pmModalProjectTeams.length === 0))}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Saving…" : pmCreateMode === "self" ? "Create My Task" : "Create Project Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project Manager Task-update follow-up: a THIRD, separate modal for
          editing an EXISTING task — never the two create-only forms above.
          Only the whitelisted fields are editable; Assignee is shown
          read-only (never hidden — the PM should see who owns a delegated
          task), and Project is not shown at all (immutable for a PM, per
          the backend's own rejection of project_id in this actor's PATCH). */}
      {isPlainProjectManager && isModalOpen && isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Edit Task</h2>
                <p className="mt-1 text-sm text-slate-500">Update this task's core details.</p>
              </div>
              <button type="button" onClick={closeModal}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            {formError && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            )}

            <form onSubmit={handlePmEditSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Task name *</label>
                <input name="name" value={formData.name} onChange={handleChange} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange}
                  rows={4} placeholder="Add task details..."
                  className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400" />
              </div>

              <TaskTimeTracker taskId={editingTaskId} onTimeChange={refreshTaskWorkingTimes} />

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Priority</label>
                  <Select name="priority" value={formData.priority} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                  <Select name="status" value={formData.status} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Start date</label>
                  <DatePicker name="start_date" value={formData.start_date} onChange={handleChange} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Due date</label>
                  <DatePicker name="due_date" value={formData.due_date} onChange={handleChange} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Assignee</label>
                {/* Read-only, never editable here — a Project Manager
                    delegates a Task to a Team; the Team Manager decides
                    the individual owner. Shown so the PM can see who
                    currently owns it, not hidden entirely. */}
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {editingTask?.assignee?.full_name || "Unassigned"}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Team</label>
                {!editingTask?.project_id ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400">
                    This task has no project.
                  </p>
                ) : isPmModalTeamsLoading ? (
                  <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400">
                    Loading teams…
                  </p>
                ) : (
                  <Select name="team_id" value={formData.team_id} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Unassigned</option>
                    {pmModalProjectTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  Only teams attached to this project — changing the team never changes the current assignee.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {isSubmitting ? "Saving…" : "Update Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
