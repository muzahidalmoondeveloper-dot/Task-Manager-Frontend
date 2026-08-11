// Plain constants/functions shared between MeetingsTab.jsx and
// CreateMeetingModal.jsx — split out from meetingHelpers.jsx (which holds
// the Avatar *component*) so neither file mixes component and non-component
// exports, per react-refresh/only-export-components.

// The 9 prebuilt meeting types (Smart Meeting System plan, section 5) —
// mirrors backend/app/core/meeting_constants.py. Older meetings created
// before this list existed (weekly/l10/quarterly/annual) still display
// fine — any lookup here falls back to the raw stored value when not found.
export const MEETING_TYPES = [
  { value: "weekly_sync", label: "Weekly Team Sync" },
  { value: "project_review", label: "Project Review" },
  { value: "sprint_planning", label: "Sprint Planning" },
  { value: "daily_standup", label: "Daily Standup" },
  { value: "one_on_one", label: "1:1 Meeting" },
  { value: "client_meeting", label: "Client Meeting" },
  { value: "retrospective", label: "Retrospective" },
  { value: "leadership_review", label: "Leadership Review" },
  { value: "custom", label: "Custom Meeting" },
];

export function fmtDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function fmtDuration(mins) {
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function getInitials(name) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export const AVATAR_COLORS = [
  "bg-indigo-500", "bg-violet-500", "bg-emerald-500", "bg-sky-500",
  "bg-amber-500", "bg-rose-500", "bg-teal-500", "bg-fuchsia-500",
];
