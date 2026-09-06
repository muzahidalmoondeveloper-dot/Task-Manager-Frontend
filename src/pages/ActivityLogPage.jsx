import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { activityLogApi } from "../api/activityLogApi";
import { resolveMediaUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Select from "../components/Select";
import { timeAgo } from "../utils/timeAgo";
import { formatDurationSeconds } from "../utils/duration";

const PAGE_SIZE = 25;

// Organization-wide Activity Log is Owner/Admin only (role or granted
// `is_org_admin` flag) — matches the backend, which gates GET
// /activity-logs behind require_org_admin, the exact same dependency that
// already protects GET /users. Same direct-navigation guard pattern as
// UsersPage.jsx's canViewOrgUsers — the sidebar link is already hidden for
// everyone else, but a direct URL visit must be redirected too, not just
// left to a 403 from the API.
function canViewActivityLog(user) {
  if (!user) return true; // don't redirect before the user has loaded
  return user.role === "owner" || user.role === "admin" || Boolean(user.is_org_admin);
}

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "task.created", label: "Task created" },
  { value: "task.updated", label: "Task updated" },
  { value: "task.deleted", label: "Task deleted" },
  { value: "task.timer_started", label: "Timer started" },
  { value: "task.timer_stopped", label: "Timer stopped" },
  { value: "project.created", label: "Project created" },
  { value: "project.updated", label: "Project updated" },
  { value: "project.deleted", label: "Project deleted" },
  { value: "project.manager_assigned", label: "Project manager assigned" },
  { value: "project.manager_removed", label: "Project manager removed" },
  { value: "team.created", label: "Team created" },
  { value: "team.updated", label: "Team updated" },
  { value: "team.deleted", label: "Team deleted" },
  { value: "user.updated", label: "User updated" },
  { value: "user.role_changed", label: "Role changed" },
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
// entity name/metadata are already safe, bounded values by the time they
// reach here (see backend app/services/activity_service.py).
function describeActivity(entry) {
  const label = entry.entity_label || (entry.entity_type ? `this ${entry.entity_type}` : "something");
  const meta = entry.metadata || {};
  switch (entry.action) {
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
    case "user.role_changed":
      return meta.from_role && meta.to_role
        ? `changed ${label}'s role — ${meta.from_role} → ${meta.to_role}`
        : `changed ${label}'s role`;
    case "user.updated":
      return `updated ${label}'s profile`;
    default:
      return `${entry.action} — ${label}`;
  }
}

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
  const [actionFilter, setActionFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    try {
      setIsLoading(true);
      setError("");
      const data = await activityLogApi.list({ page, page_size: PAGE_SIZE, action: actionFilter || undefined });
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
  }, [page, actionFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Activity Log</h1>
          <p className="mt-1 text-sm text-slate-500">Meaningful actions performed by users in your organization.</p>
        </div>

        <Select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-64"
        >
          {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
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
          <div className="px-4 py-16 text-center text-sm text-slate-500">No activity recorded yet.</div>
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
                  <p className="mt-0.5 text-xs text-slate-400">{timeAgo(entry.created_at)}</p>
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
