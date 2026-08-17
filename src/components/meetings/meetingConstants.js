// Plain constants/functions shared between MeetingsTab.jsx and
// CreateMeetingModal.jsx — split out from meetingHelpers.jsx (which holds
// the Avatar *component*) so neither file mixes component and non-component
// exports, per react-refresh/only-export-components.

// The 4 EOS-style meeting types shown on the Create Meeting page. Replaces
// the older 9-type list (weekly_sync/project_review/etc.) — any meeting
// created under one of those still displays fine, since every lookup below
// falls back to the raw stored value when its type isn't found here.
export const MEETING_TYPES = [
  { value: "level_10", label: "Level 10 Meeting™" },
  { value: "eos_planning", label: "EOS Planning" },
  { value: "same_page", label: "Same Page" },
  { value: "custom", label: "Custom Agenda" },
];

// Duration + starting agenda per type, for the Create Meeting page's type
// cards and live preview. Level 10's breakdown (Segue/KPI/Rock
// Review/Headlines/To-Do List/IDS/Conclude) is the standard EOS weekly
// meeting pulse; EOS Planning and Same Page are reasonable section
// breakdowns at their stated total length — edit freely once created,
// these are just a starting point. "custom" has no duration/agenda at
// all ("Length TBD") — the user builds it from scratch.
export const MEETING_TYPE_PRESETS = {
  level_10: {
    label: "Level 10 Meeting™",
    durationLabel: "90 minutes",
    defaultDurationMinutes: 90,
    agenda: [
      { key: "segue", title: "Segue", duration_minutes: 5 },
      { key: "scorecard", title: "KPI", duration_minutes: 5 },
      { key: "rock_review", title: "Rock Review", duration_minutes: 5 },
      { key: "news", title: "News", duration_minutes: 5 },
      { key: "todo_list", title: "To-Do List", duration_minutes: 5 },
      { key: "ids", title: "IDS", duration_minutes: 60 },
      { key: "conclude", title: "Conclude", duration_minutes: 5 },
    ],
  },
  eos_planning: {
    label: "EOS Planning",
    durationLabel: "355 minutes",
    defaultDurationMinutes: 355,
    agenda: [
      { key: "segue", title: "Segue", duration_minutes: 10 },
      { key: "scorecard", title: "Review Prior Quarter", duration_minutes: 30 },
      { key: "rock_review", title: "Review KPI & Rocks", duration_minutes: 30 },
      { key: "news", title: "Review V/TO", duration_minutes: 30 },
      { key: "swot", title: "SWOT Analysis", duration_minutes: 45 },
      { key: "todo_list", title: "Set Next Quarter's Rocks", duration_minutes: 60 },
      { key: "ids", title: "IDS", duration_minutes: 120 },
      { key: "conclude", title: "Next Steps & Conclude", duration_minutes: 30 },
    ],
  },
  same_page: {
    label: "Same Page",
    durationLabel: "120 minutes",
    defaultDurationMinutes: 120,
    agenda: [
      { key: "segue", title: "Personal Check-in", duration_minutes: 15 },
      { key: "news", title: "Review Business Priorities", duration_minutes: 30 },
      { key: "ids", title: "IDS", duration_minutes: 45 },
      { key: "feedback", title: "Feedback", duration_minutes: 20 },
      { key: "conclude", title: "Next Steps", duration_minutes: 10 },
    ],
  },
  custom: {
    label: "Custom Agenda",
    durationLabel: "Length TBD",
    defaultDurationMinutes: 0,
    agenda: [],
  },
};

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

// Live meeting reaction bar (MeetingsTab.jsx) — a fresh, randomized
// starting point + a bit of sideways drift + a slightly different speed
// for every single reaction, so a burst of clicks doesn't produce a stack
// of identical emoji rising in lockstep from the same spot. Deliberately a
// plain module-level function (not defined inside the component) — a
// stricter lint rule elsewhere in this app flags Date.now()/Math.random()
// written directly inside a component/hook body as an "impure render"
// smell, even when the call only actually happens from an event handler;
// keeping the randomness in an ordinary helper function sidesteps that.
export function randomReactionOffset() {
  return {
    left: 12 + Math.random() * 68,                    // % from the left, kept off the very edges
    driftX: Math.round((Math.random() - 0.5) * 140),   // px of sideways wobble while it rises
    duration: 2.8 + Math.random() * 1.0,               // seconds (2.8s–3.8s) — every reaction rises at a slightly different pace
    peakScale: 1.08 + Math.random() * 0.14,             // the "pop" at ~10% varies a little too (≈1.08–1.22)
    riseVh: Math.round(50 + Math.random() * 20),        // travels 50–70% of the viewport height, a little different every time
  };
}
