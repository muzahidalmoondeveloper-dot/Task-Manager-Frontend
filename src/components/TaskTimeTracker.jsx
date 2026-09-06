import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { taskApi } from "../api/taskApi";
import { formatDurationSeconds, formatLiveDurationSeconds } from "../utils/duration";
import { useLiveDuration } from "../hooks/useLiveDuration";
import { useAuth } from "../context/AuthContext";

// Minimal Start/Stop time-tracking control for the task edit surfaces
// (Task #7A foundation). Persisted truth always lives on the server
// (TaskTimeEntry); this component only re-fetches that state on mount
// (so it's correct after navigation/reload/login) and, while a timer is
// active, ticks its own display once a second between fetches, via the
// shared `useLiveDuration` baseline hook (Task List Working Time
// follow-up) — it never invents or persists a duration itself.
//
// Root cause of the earlier "timer doesn't visibly count" bug: the
// interval WAS firing every second and the underlying seconds value WAS
// incrementing correctly — the display just went through
// `formatDurationSeconds()`, a compact/summary formatter that rounds to
// whole minutes and returns "0m" for anything under 60s. The fix is a
// dedicated live formatter (`formatLiveDurationSeconds`, HH:MM:SS) used
// only while a timer is active; `formatDurationSeconds` is unchanged and
// still used for the stopped state.
export default function TaskTimeTracker({ taskId, onTimeChange }) {
  const { user } = useAuth();
  const [state, setState] = useState(null); // { tracked_time_seconds, is_active, active_started_at, active_timer_count, assignee_id }
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  // Whether the CALLER's own session is the one running — this is what
  // picks Stop vs Start, never the task-wide aggregate below.
  const isMyOwnActive = Boolean(state?.is_active);
  // Assignee-Only Timer Control follow-up: Start/Stop render only for the
  // task's CURRENT assignee — never for an Owner/Admin/Manager merely
  // because they can open this Task Edit surface at all. `assignee_id`
  // comes straight from the same authoritative TaskTimeState response
  // this component already fetches, so no extra request is needed.
  const canControlTimer = state != null && state.assignee_id != null && state.assignee_id === user?.id;
  // Read access is broader than control access (Phase 5): the task-wide
  // Running state/live tick must stay visible to any authorized viewer
  // (e.g. an Admin watching the assignee's timer run), never just the
  // caller's own session — `active_timer_count` is that task-wide signal.
  const isRunning = (state?.active_timer_count ?? 0) > 0;
  // The task may have more than one simultaneously active timer (legacy
  // data — see the Assignee-Only Timer Control follow-up's note that new
  // Starts are now confined to a single assignee) — tick at that combined
  // rate, never assuming 1.
  const liveSeconds = useLiveDuration(state?.tracked_time_seconds ?? 0, isRunning ? Math.max(state?.active_timer_count || 1, 1) : 0);

  async function loadState() {
    try {
      const data = await taskApi.getTimeState(taskId);
      setState(data);
    } catch (err) {
      toast.error(err.message || "Failed to load tracked time.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!taskId) return;
    loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function handleStart() {
    if (isBusy) return;
    try {
      setIsBusy(true);
      const data = await taskApi.startTimer(taskId);
      setState(data);
      // Optional — e.g. ProjectDetailPage refreshes its own Project
      // Working Time aggregate here. Every other surface this shared
      // component is used on (TasksPage, TeamDetailPage, meetings) simply
      // never passes this prop, so it stays fully decoupled from any of
      // them.
      onTimeChange?.();
    } catch (err) {
      toast.error(err.message || "Failed to start timer.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleStop() {
    if (isBusy) return;
    try {
      setIsBusy(true);
      const data = await taskApi.stopTimer(taskId);
      setState(data);
      toast.success("Timer stopped.");
      onTimeChange?.();
    } catch (err) {
      toast.error(err.message || "Failed to stop timer.");
    } finally {
      setIsBusy(false);
    }
  }

  if (!taskId) return null;

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">Working Time</label>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-300 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={isRunning ? "font-mono text-sm font-semibold text-slate-900" : "text-sm font-semibold text-slate-900"}>
            {isLoading ? "…" : isRunning ? formatLiveDurationSeconds(liveSeconds) : formatDurationSeconds(state?.tracked_time_seconds ?? 0)}
          </span>
          {!isLoading && isRunning && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Running
            </span>
          )}
        </div>
        {!isLoading && (
          canControlTimer ? (
            isMyOwnActive ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={isBusy}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isBusy ? "Stopping…" : "Stop Timer"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={isBusy}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {isBusy ? "Starting…" : "Start Timer"}
              </button>
            )
          ) : (
            // Assignee-Only Timer Control follow-up: an authorized
            // non-assignee viewer still sees the Working Time (and, above,
            // the live Running state) — just no control. Subtle, muted
            // helper text only, never hiding the value itself.
            <span className="text-xs text-slate-400">Only the assignee can track time.</span>
          )
        )}
      </div>
    </div>
  );
}
