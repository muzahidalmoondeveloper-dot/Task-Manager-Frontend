import { useState } from "react";
import toast from "react-hot-toast";

import { taskApi } from "../api/taskApi";
import { formatDurationSeconds, formatLiveDurationSeconds } from "../utils/duration";
import { useLiveDuration } from "../hooks/useLiveDuration";

// Shared Working Time display + direct Start/Stop control for Task
// list/table/card rows (TasksPage, ProjectDetail's Task list, TeamDetail's
// Task list) — one implementation instead of three. Values always come
// from the parent's bulk `/tasks/time-summaries` response, never a
// per-row `/tasks/{id}/time` call — this component never fetches on its
// own; it only calls the existing Start/Stop routes (the same
// `taskApi.startTimer`/`stopTimer` TaskTimeTracker already uses — no
// duplicate API methods) and reports success back via `onTimeChange` so
// the parent can refresh its bulk summary (and, on ProjectDetail, the
// Project Working Time card).
//
// Critical distinction (Start/Stop-from-list follow-up): `activeTimerCount`
// describes the TASK aggregate — it can be > 0 purely because some OTHER
// user is timing this task, and must never by itself decide whether this
// row shows "Stop". Only `currentUserIsActive` (the caller's own session,
// server-derived from TenantContext) may ever do that.
//
// Assignee-Only Timer Control follow-up: `canControlTimer` is a THIRD,
// independent gate — the caller must be this task's CURRENT assignee
// (`task.assignee_id === currentUser.id`, computed by the parent, which
// already has the full task object) before Start/Stop renders AT ALL.
// Neither `currentUserIsActive` nor `activeTimerCount` may substitute for
// this: an Admin/Owner/Manager who is not the assignee sees the Working
// Time value and the Running indicator exactly like any other authorized
// viewer, but never a button — "prefer not rendering a control the user
// can never use" (per that follow-up's spec) rather than showing a
// disabled one. The backend independently re-enforces this on every
// Start/Stop request regardless of what this prop says.
export default function WorkingTimeCell({
  taskId,
  workingTimeSeconds,
  activeTimerCount,
  currentUserIsActive = false,
  currentUserHasActiveTimerElsewhere = false,
  canControlTimer = false,
  onTimeChange,
  className = "",
}) {
  const [isBusy, setIsBusy] = useState(false);

  const seconds = workingTimeSeconds || 0;
  const isRunning = (activeTimerCount || 0) > 0; // TASK aggregate — display only, never a Start/Stop decision
  const liveSeconds = useLiveDuration(seconds, activeTimerCount || 0);

  async function handleStart() {
    if (isBusy) return;
    try {
      setIsBusy(true);
      await taskApi.startTimer(taskId);
      onTimeChange?.();
    } catch (err) {
      // Includes the 409 "you already have another active timer" case —
      // never fabricate a locally-running state here; just surface the
      // error and let the next bulk refresh reconcile the real state.
      toast.error(err.message || "Failed to start timer.");
      onTimeChange?.();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleStop() {
    if (isBusy) return;
    try {
      setIsBusy(true);
      await taskApi.stopTimer(taskId);
      onTimeChange?.();
    } catch (err) {
      toast.error(err.message || "Failed to stop timer.");
      onTimeChange?.();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className={isRunning ? "font-mono font-semibold text-slate-900" : "text-slate-700"}>
          {isRunning ? formatLiveDurationSeconds(liveSeconds) : formatDurationSeconds(seconds)}
        </span>
        {isRunning && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Running
          </span>
        )}
      </span>

      {taskId != null && canControlTimer && (
        currentUserIsActive ? (
          <button
            type="button"
            onClick={handleStop}
            disabled={isBusy}
            className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {isBusy ? "Stopping…" : "Stop"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={isBusy || currentUserHasActiveTimerElsewhere}
            title={currentUserHasActiveTimerElsewhere ? "Stop your current timer before starting another task." : undefined}
            className="rounded-md border border-teal-600 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:hover:bg-transparent"
          >
            {isBusy ? "Starting…" : "Start"}
          </button>
        )
      )}
    </span>
  );
}
