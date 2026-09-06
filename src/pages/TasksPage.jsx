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
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM18 10a2 2 0 11-4 0 2 2 0 014 0z" />
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

// ─── Task card for mobile ─────────────────────────────────────────────────────

function TaskCard({ task, canManageTasks, isTeamMember, user, onEdit, onDelete, onStatusChange, onApprove, onAssignBack, reviewActionTaskId, workingTime, currentUserHasActiveTimer, onTimeChange }) {
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
      ) : isTeamMember && task.assignee_id === user?.id && task.status !== "pending_review" && task.status !== "done" ? (
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
  isTeamMember,
  userId,
  assignees,
  onQuickStatus,
  onQuickPriority,
  onQuickAssignee,
  onApprove,
  onAssignBack,
  onToggleMenu,
  workingTime,
  currentUserHasActiveTimer,
  onTimeChange,
  assignableUsersByTeamId,
  assignableUsersLoading,
}) {
  const canChange = canManageTasks || (
    isTeamMember &&
    task.assignee_id === userId &&
    task.status !== "pending_review" &&
    task.status !== "done"
  );

  const statusOpts = canManageTasks
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
          disabled={task.status === "pending_review" || (!canManageTasks && task.assignee_id !== userId)}
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
        {canManageTasks ? (
          <Select value={task.priority || "medium"} onChange={(e) => onQuickPriority(task, e.target.value)}
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
          task.assignee?.full_name || "—"
        )}
      </td>

      {/* Team */}
      <td className="px-4 py-4 align-middle text-slate-700">{task.team?.name || "—"}</td>

      {/* Start date */}
      <td className="px-4 py-4 align-middle text-slate-700">
        {task.start_date ? formatDate(task.start_date) : <span className="text-slate-400">—</span>}
      </td>

      {/* Due date */}
      <td className="px-4 py-4 align-middle"><DueDateCell task={task} /></td>

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
      {canManageTasks && (
        <td className="px-4 py-4 text-right align-middle">
          {task.status === "pending_review" ? (
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
            <button
              type="button"
              onClick={(e) => onToggleMenu(e, task.id)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <ThreeDotsIcon />
            </button>
          )}
        </td>
      )}
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

  // Loading / error
  const [myTasksLoading,  setMyTasksLoading]  = useState(true);
  const [allTasksLoading, setAllTasksLoading] = useState(false);
  const [myTasksError,    setMyTasksError]    = useState("");
  const [allTasksError,   setAllTasksError]   = useState("");

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
  const [menuPos,        setMenuPos]        = useState(null);
  const [reviewActionId, setReviewActionId] = useState(null);
  const [celebrationData,setCelebrationData]= useState(null);

  // Calendar
  const [calDate, setCalDate] = useState(new Date());

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
    try {
      const [userData, projectData, teamData] = await Promise.all([
        userApi.list(),
        projectApi.list(),
        teamApi.list(),
      ]);
      setUsers(userData);
      setProjects(projectData);
      setTeams(teamData);
    } catch {
      // non-critical
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
    if (canManageTasks) {
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

  const myTasksByDueDate = useMemo(() =>
    filteredMyTasks.reduce((acc, t) => {
      if (!t.due_date) return acc;
      (acc[t.due_date] = acc[t.due_date] || []).push(t);
      return acc;
    }, {}),
    [filteredMyTasks]
  );

  const groupedByStatus = useMemo(() =>
    STATUS_OPTIONS.reduce((acc, s) => { acc[s.value] = filteredAllTasks.filter((t) => t.status === s.value); return acc; }, {}),
    [filteredAllTasks]
  );

  const tasksByDueDate = useMemo(() =>
    filteredAllTasks.reduce((acc, t) => {
      if (!t.due_date) return acc;
      (acc[t.due_date] = acc[t.due_date] || []).push(t);
      return acc;
    }, {}),
    [filteredAllTasks]
  );

  const [myCalDate, setMyCalDate] = useState(new Date());
  const myCalDays = useMemo(() => getMonthMatrix(myCalDate.getFullYear(), myCalDate.getMonth()), [myCalDate]);

  const calDays = useMemo(() => getMonthMatrix(calDate.getFullYear(), calDate.getMonth()), [calDate]);

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
      .then((members) => setTeamAssignableUsers(Array.isArray(members) ? members : []))
      .catch(() => setTeamAssignableUsers([]));
  }, [formData.team_id]);

  // The dropdown's actual option source: Team eligibility wins whenever a
  // team is selected (Rule B/C precedence), org-wide list otherwise.
  const modalAssignees = formData.team_id ? teamAssignableUsers : assignees;

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
    if (canManageTasks) return STATUS_OPTIONS;
    if (task.status === "pending_review" || task.status === "done") return STATUS_OPTIONS.filter((o) => o.value === task.status);
    return TEAM_MEMBER_STATUS_OPTIONS;
  }

  function canChangeStatus(task) {
    if (canManageTasks) return true;
    return isTeamMember && task.assignee_id === user?.id && task.status !== "pending_review" && task.status !== "done";
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
  }

  function openCreateModal() {
    resetForm();
    setOpenMenuId(null);
    setIsModalOpen(true);
    // No specific task exists yet to be "this"/"it" — clear any stale
    // context left over from a previously-edited task.
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
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError("");
    try {
      const payload = {
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
        const updated = await taskApi.update(editingTaskId, payload);
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
    setOpenMenuId(null);
    try {
      const updated = await taskApi.updateStatus(task.id, newStatus);
      updateTaskInLists(updated);
      if (updated.status === "done") {
        const isSelf = task.assignee_id === user?.id;
        setCelebrationData({ taskName: updated.name, completedByName: isSelf ? null : (task.assignee?.full_name || null) });
      } else {
        toast.success("Status updated.");
      }
    } catch (err) {
      toast.error(err.message || "Unable to update status.");
    }
  }

  async function quickPriorityUpdate(task, newPriority) {
    try {
      const updated = await taskApi.update(task.id, { priority: newPriority });
      updateTaskInLists(updated);
      toast.success("Priority updated.");
    } catch (err) {
      toast.error(err.message || "Unable to update priority.");
    }
  }

  async function quickAssigneeUpdate(task, newAssigneeId) {
    try {
      const updated = await taskApi.update(task.id, { assignee_id: newAssigneeId ? Number(newAssigneeId) : null });
      updateTaskInLists(updated);
      toast.success("Assignee updated.");
    } catch (err) {
      toast.error(err.message || "Unable to update assignee.");
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
    ...(canManageTasks ? [{ key: "all_tasks", label: "All Tasks" }] : []),
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
        {canManageTasks && (
          <button type="button" onClick={openCreateModal}
            className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            + Add Task
          </button>
        )}
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
                                  disabled={task.status === "pending_review"}
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
                                {canManageTasks ? (
                                  <Select value={task.priority || "medium"} onChange={(e) => quickPriorityUpdate(task, e.target.value)}
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
                                {task.start_date ? formatDate(task.start_date) : <span className="text-slate-400">—</span>}
                              </td>
                              <td className="px-4 py-4 align-middle"><DueDateCell task={task} /></td>
                              <td className="px-4 py-4 align-middle">
                                {canChangeStatus(task) ? (
                                  <Select value={task.status} onChange={(e) => quickStatusUpdate(task, e.target.value)}
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
                                {canManageTasks && (
                                  task.status === "pending_review" ? (
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
                                    <button type="button" onClick={(e) => handleMenuToggle(e, task.id)}
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                                      <ThreeDotsIcon />
                                    </button>
                                  )
                                )}
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
                        isTeamMember={isTeamMember}
                        user={user}
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
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setMyCalDate(new Date(myCalDate.getFullYear(), myCalDate.getMonth() - 1, 1))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">‹</button>
                  <button type="button" onClick={() => setMyCalDate(new Date())}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Today</button>
                  <button type="button" onClick={() => setMyCalDate(new Date(myCalDate.getFullYear(), myCalDate.getMonth() + 1, 1))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">›</button>
                </div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {myCalDate.toLocaleString("default", { month: "long", year: "numeric" })}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-7 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
                      <div key={d} className="border-r border-slate-200 p-3">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {myCalDays.map((day) => {
                      const key = toDateInputValue(day);
                      const dayTasks = myTasksByDueDate[key] || [];
                      const isCurrent = day.getMonth() === myCalDate.getMonth();
                      return (
                        <div key={key} className={`min-h-28 border-r border-b border-slate-200 p-2 ${isCurrent ? "" : "bg-slate-50 text-slate-400"}`}>
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-semibold">{day.getDate()}</span>
                            {dayTasks.length > 0 && (
                              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">{dayTasks.length}</span>
                            )}
                          </div>
                          <div className="space-y-1">
                            {dayTasks.slice(0, 3).map((task) => (
                              <div key={task.id}
                                className={
                                  task.status === "pending_review" ? "block w-full truncate rounded bg-amber-100 px-2 py-1 text-left text-xs font-medium text-amber-900"
                                  : task.status === "done" ? "block w-full truncate rounded bg-green-100 px-2 py-1 text-left text-xs font-medium text-green-900 line-through"
                                  : "block w-full truncate rounded bg-teal-100 px-2 py-1 text-left text-xs font-medium text-teal-900"
                                }
                              >{task.name}</div>
                            ))}
                            {dayTasks.length > 3 && <p className="text-xs text-slate-500">+{dayTasks.length - 3} more</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* ── ALL TASKS ────────────────────────────────────────────────────────── */}
      {primaryTab === "all_tasks" && canManageTasks && (
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
                              isTeamMember={isTeamMember}
                              userId={user?.id}
                              assignees={assignees}
                              onQuickStatus={quickStatusUpdate}
                              onQuickPriority={quickPriorityUpdate}
                              onQuickAssignee={quickAssigneeUpdate}
                              onApprove={approveTask}
                              onAssignBack={assignBackTask}
                              onToggleMenu={handleMenuToggle}
                              workingTime={taskWorkingTimes[task.id]}
                              currentUserHasActiveTimer={currentUserHasActiveTimer}
                              onTimeChange={refreshTaskWorkingTimes}
                              assignableUsersByTeamId={assignableUsersByTeamId}
                              assignableUsersLoading={assignableUsersLoading}
                            />
                          )) : (
                            <tr>
                              <td colSpan={11}>
                                <EmptyState message={allFiltersActive ? "No tasks match your filters." : "No tasks yet. Create one above."} />
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
                      <EmptyState message={allFiltersActive ? "No tasks match your filters." : "No tasks yet."} />
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
                          <p className="mt-1 text-xs text-slate-500">Assignee: {task.assignee?.full_name || "—"}</p>
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
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">‹</button>
                  <button type="button" onClick={() => setCalDate(new Date())}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Today</button>
                  <button type="button" onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">›</button>
                </div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {calDate.toLocaleString("default", { month: "long", year: "numeric" })}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-7 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
                      <div key={d} className="border-r border-slate-200 p-3">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {calDays.map((day) => {
                      const key = toDateInputValue(day);
                      const dayTasks = tasksByDueDate[key] || [];
                      const isCurrent = day.getMonth() === calDate.getMonth();
                      return (
                        <div key={key} className={`min-h-28 border-r border-b border-slate-200 p-2 ${isCurrent ? "" : "bg-slate-50 text-slate-400"}`}>
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-semibold">{day.getDate()}</span>
                            {dayTasks.length > 0 && (
                              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">{dayTasks.length}</span>
                            )}
                          </div>
                          <div className="space-y-1">
                            {dayTasks.slice(0, 3).map((task) => (
                              <button key={task.id} type="button" onClick={() => handleEdit(task)}
                                className={
                                  task.status === "pending_review" ? "block w-full truncate rounded bg-amber-100 px-2 py-1 text-left text-xs font-medium text-amber-900"
                                  : task.status === "done" ? "block w-full truncate rounded bg-green-100 px-2 py-1 text-left text-xs font-medium text-green-900 line-through"
                                  : "block w-full truncate rounded bg-teal-100 px-2 py-1 text-left text-xs font-medium text-teal-900"
                                }
                              >{task.name}</button>
                            ))}
                            {dayTasks.length > 3 && <p className="text-xs text-slate-500">+{dayTasks.length - 3} more</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
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
            Edit
          </button>
          <button type="button" onClick={() => { setMenuPos(null); handleDelete(openMenuTask); }}
            className="block w-full px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50">
            Delete
          </button>
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

              {/* Managers/admins can assign a task directly on creation, not
                  just when editing — leave unassigned to land it in the
                  team's To-Do list instead. Assigning to yourself is just
                  picking your own name here, same as anyone else. */}
              {canManageTasks && (
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

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Project</label>
                <Select name="project_id" value={formData.project_id} onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">Select project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Team</label>
                <Select name="team_id" value={formData.team_id} onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">Select team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
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
    </div>
  );
}
