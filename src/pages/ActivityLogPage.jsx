import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { activityLogApi } from "../api/activityLogApi";
import { userApi } from "../api/userApi";
import { resolveMediaUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Select from "../components/Select";
import DatePicker from "../components/DatePicker";
import { timeAgo } from "../utils/timeAgo";
import { formatDurationSeconds } from "../utils/duration";

const PAGE_SIZE = 25;

// Organization-wide Activity Log is Owner/Admin only (role or granted
// `is_org_admin` flag) — matches the backend, which gates GET
// /activity-logs behind require_org_admin, the exact same dependency that
// already protects GET /users. Same direct-navigation guard pattern as
// UsersPage.jsx's canViewOrgUsers — the sidebar link is already hidden for
// everyone else, but a direct URL visit must be redirected too, not just
// left to a 403 from the API. This visibility rule intentionally does NOT
// extend to Team Manager, Project Manager, Team Member, Client, or a
// combined Team Manager + Project Manager account — the backend is the
// real boundary (GET /activity-logs 403s them regardless of this check),
// this is only about not showing a page that will just error for them.
function canViewActivityLog(user) {
  if (!user) return true; // don't redirect before the user has loaded
  return user.role === "owner" || user.role === "admin" || Boolean(user.is_org_admin);
}

// Category → action catalog (Task #8B). Mirrors the backend's closed
// taxonomy (app/core/activity_actions.py) exactly — every action here is a
// real, wired-up product event, never a placeholder for a feature that
// doesn't exist. The Action filter is scoped to whichever category is
// selected so it never offers an action from a different category.
const CATEGORIES = [
  { value: "", label: "All categories" },
  { value: "authentication", label: "Authentication" },
  { value: "users", label: "Users & Access" },
  { value: "tasks", label: "Tasks" },
  { value: "projects", label: "Projects" },
  { value: "teams", label: "Teams" },
  { value: "organization", label: "Organization" },
  { value: "integrations", label: "Integrations" },
];

const ACTIONS = [
  { value: "auth.login", label: "Logged in", category: "authentication" },
  { value: "auth.logout", label: "Logged out", category: "authentication" },
  { value: "auth.password_changed", label: "Password changed", category: "authentication" },
  { value: "auth.password_reset_completed", label: "Password reset completed", category: "authentication" },
  { value: "user.invited", label: "User invited", category: "users" },
  { value: "user.created", label: "User created", category: "users" },
  { value: "user.updated", label: "User updated", category: "users" },
  { value: "user.role_changed", label: "Role changed", category: "users" },
  { value: "user.activated", label: "User activated", category: "users" },
  { value: "user.deactivated", label: "User deactivated", category: "users" },
  { value: "task.created", label: "Task created", category: "tasks" },
  { value: "task.updated", label: "Task updated", category: "tasks" },
  { value: "task.deleted", label: "Task deleted", category: "tasks" },
  { value: "task.timer_started", label: "Timer started", category: "tasks" },
  { value: "task.timer_stopped", label: "Timer stopped", category: "tasks" },
  { value: "project.created", label: "Project created", category: "projects" },
  { value: "project.updated", label: "Project updated", category: "projects" },
  { value: "project.deleted", label: "Project deleted", category: "projects" },
  { value: "project.manager_assigned", label: "Project manager assigned", category: "projects" },
  { value: "project.manager_removed", label: "Project manager removed", category: "projects" },
  { value: "team.created", label: "Team created", category: "teams" },
  { value: "team.updated", label: "Team updated", category: "teams" },
  { value: "team.deleted", label: "Team deleted", category: "teams" },
  { value: "organization.updated", label: "Organization updated", category: "organization" },
  { value: "organization.settings_updated", label: "Organization settings updated", category: "organization" },
  { value: "integration.connected", label: "Integration connected", category: "integrations" },
  { value: "integration.disconnected", label: "Integration disconnected", category: "integrations" },
];

function getInitials(name) {
  return (name || "?")
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Turns one ActivityLog record into a short, readable sentence — the
// entity name/metadata are already safe, bounded, whitelisted values by
// the time they reach here (see backend app/services/activity_service.py)
// — this never renders raw JSON or an unrecognized metadata key.
function describeActivity(entry) {
  const label = entry.entity_label || (entry.entity_type ? `this ${entry.entity_type}` : "something");
  const meta = entry.metadata || {};
  switch (entry.action) {
    case "auth.login":
      return "logged in";
    case "auth.logout":
      return "logged out";
    case "auth.password_changed":
      return "changed their password";
    case "auth.password_reset_completed":
      return "reset their password";
    case "user.invited":
      return `sent an invitation — ${label}`;
    case "user.created":
      return `created a new user account — ${label}`;
    case "user.updated":
      return `updated ${label}'s profile`;
    case "user.role_changed":
      return meta.from_role && meta.to_role
        ? `changed ${label}'s role — ${meta.from_role} → ${meta.to_role}`
        : `changed ${label}'s role`;
    case "user.activated":
      return `activated ${label}'s account`;
    case "user.deactivated":
      return `deactivated ${label}'s account`;
    case "task.created":
      return `created task "${label}"`;
    case "task.updated": {
      if (meta.status_from && meta.status_to) {
        return `updated task "${label}" — Status: ${meta.status_from} → ${meta.status_to}`;
      }
      if (meta.priority_from && meta.priority_to) {
        return `updated task "${label}" — Priority: ${meta.priority_from} → ${meta.priority_to}`;
      }
      return `updated task "${label}"`;
    }
    case "task.deleted":
      return `deleted task "${label}"`;
    case "task.timer_started":
      return `started a timer on "${label}"`;
    case "task.timer_stopped": {
      const duration = typeof meta.duration_seconds === "number" ? ` (${formatDurationSeconds(meta.duration_seconds)})` : "";
      return `stopped the timer on "${label}"${duration}`;
    }
    case "project.created":
      return `created project "${label}"`;
    case "project.updated":
      return `updated project "${label}"`;
    case "project.deleted":
      return `deleted project "${label}"`;
    case "project.manager_assigned":
      return `assigned a Project Manager for "${label}"`;
    case "project.manager_removed":
      return `removed the Project Manager from "${label}"`;
    case "team.created":
      return `created team "${label}"`;
    case "team.updated":
      return `updated team "${label}"`;
    case "team.deleted":
      return `deleted team "${label}"`;
    case "organization.updated":
      return meta.name_to ? `updated the organization — renamed to "${meta.name_to}"` : "updated the organization";
    case "organization.settings_updated":
      return "updated organization settings";
    case "integration.connected":
      return `connected ${label || meta.provider || "an integration"}`;
    case "integration.disconnected":
      return `disconnected ${label || meta.provider || "an integration"}`;
    default:
      return `${entry.action} — ${label}`;
  }
}

// Professional, readable timestamp — e.g. "Sep 6, 2026 • 9:32 PM". Always
// derived from the ISO string the API returns; never stored formatted.
function formatTimestamp(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const datePart = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${datePart} • ${timePart}`;
}

// UTC day-boundary helpers (Task #8B) — the From/To date pickers work in
// the viewer's local calendar day, but the filter itself must be
// backend-authoritative (never a client-side truncation of an
// already-loaded page). Converting "YYYY-MM-DD" to a precise UTC instant
// here, once, avoids an off-by-one where a user's local "today" doesn't
// line up with UTC's.
function startOfDayIso(dateStr) {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)).toISOString();
}

function endOfDayIso(dateStr) {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)).toISOString();
}

const EMPTY_FILTERS = { category: "", action: "", actorUserId: "", from: "", to: "" };

export default function ActivityLogPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !canViewActivityLog(user)) {
      toast.error("You don't have permission to access the Activity Log.");
      navigate("/dashboard", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgUsers, setOrgUsers] = useState([]);
  const hasActiveFilters = Boolean(filters.category || filters.action || filters.actorUserId || filters.from || filters.to);

  // Loaded once — the same GET /users an admin already has full authority
  // to call elsewhere in the app (UsersPage), never a per-row lookup.
  useEffect(() => {
    userApi.list().then(setOrgUsers).catch(() => setOrgUsers([]));
  }, []);

  async function load() {
    try {
      setIsLoading(true);
      setError("");
      const data = await activityLogApi.list({
        page,
        page_size: PAGE_SIZE,
        category: filters.category || undefined,
        action: filters.action || undefined,
        actor_user_id: filters.actorUserId || undefined,
        since: startOfDayIso(filters.from),
        until: endOfDayIso(filters.to),
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err.message || "Unable to load activity.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters]);

  function updateFilter(patch) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  const actionOptions = useMemo(() => {
    const scoped = filters.category ? ACTIONS.filter((a) => a.category === filters.category) : ACTIONS;
    return [{ value: "", label: "All actions" }, ...scoped];
  }, [filters.category]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Activity Log</h1>
        <p className="mt-1 text-sm text-slate-500">Meaningful actions performed by users in your organization.</p>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor="al-category" className="mb-1 block text-xs font-semibold text-slate-500">Category</label>
          <Select
            id="al-category"
            value={filters.category}
            onChange={(e) => updateFilter({ category: e.target.value, action: "" })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>

        <div>
          <label htmlFor="al-action" className="mb-1 block text-xs font-semibold text-slate-500">Action</label>
          <Select
            id="al-action"
            value={filters.action}
            onChange={(e) => updateFilter({ action: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {actionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>

        <div>
          <label htmlFor="al-user" className="mb-1 block text-xs font-semibold text-slate-500">User</label>
          <Select
            id="al-user"
            value={filters.actorUserId}
            onChange={(e) => updateFilter({ actorUserId: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All users</option>
            {orgUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </Select>
        </div>

        <div>
          <label htmlFor="al-from" className="mb-1 block text-xs font-semibold text-slate-500">From date</label>
          <DatePicker name="al-from" value={filters.from} onChange={(e) => updateFilter({ from: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="al-to" className="mb-1 block text-xs font-semibold text-slate-500">To date</label>
            <DatePicker name="al-to" value={filters.to} onChange={(e) => updateFilter({ to: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            className="h-[38px] shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="px-4 py-16 text-center text-sm text-slate-500">Loading activity…</div>
        ) : error ? (
          <div className="px-4 py-16 text-center">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button type="button" onClick={load} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-500">
            {hasActiveFilters ? "No activity matches the selected filters." : "No activity has been recorded yet."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 px-5 py-4 hover:bg-slate-50">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                  {entry.actor.profile_picture_url ? (
                    <img src={resolveMediaUrl(entry.actor.profile_picture_url)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    getInitials(entry.actor.name)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">{entry.actor.name || "Unknown User"}</span>{" "}
                    {entry.actor.is_deleted && (
                      <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-400">Deleted User</span>
                    )}
                    {describeActivity(entry)}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>{formatTimestamp(entry.created_at)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{timeAgo(entry.created_at)}</span>
                    {entry.category && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium capitalize text-slate-500">
                        {CATEGORIES.find((c) => c.value === entry.category)?.label || entry.category}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!isLoading && !error && total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>Page {page} of {totalPages} · {total} total</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
