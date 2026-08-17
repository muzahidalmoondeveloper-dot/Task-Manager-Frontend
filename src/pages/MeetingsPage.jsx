import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { meetingApi } from "../api/meetingApi";
import { teamApi } from "../api/teamApi";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import CreateMeetingModal from "../components/meetings/CreateMeetingModal";
import { Avatar } from "../components/meetings/meetingHelpers";
import { LiveMeetingPanel } from "./MeetingsTab";

/**
 * Org-wide Meetings page (sidebar, right after Users) — a day-bucketed
 * "Upcoming Meetings" panel next to a grouped "All Meetings" table, with
 * My Meetings / All Meetings tabs. Reuses MeetingsTab's LiveMeetingPanel
 * for the actual join/agenda/notes/decisions/check-in experience, and the
 * original CreateMeetingModal for editing (creation moved to its own
 * dedicated page — CreateMeetingPage, reached via "+ Create Meeting").
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtScheduleLine(meeting) {
  const d = new Date(meeting.scheduled_at);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined }).toLowerCase().replace(" ", "");
  if (meeting.recurrence === "weekly") return `${weekday}s at ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${time}`;
}

// Buckets meetings into Today / Tomorrow / This Week / Later, relative to
// now — the left "Upcoming Meetings" panel. Past meetings are excluded;
// that list belongs to the (already-existing) meeting history elsewhere.
function bucketUpcoming(meetings) {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const weekEnd = new Date(today.getTime() + 7 * DAY_MS);

  const buckets = { today: [], tomorrow: [], thisWeek: [], later: [] };
  for (const m of meetings) {
    const when = new Date(m.scheduled_at);
    if (when < today) continue;
    if (when < tomorrow) buckets.today.push(m);
    else if (when < new Date(tomorrow.getTime() + DAY_MS)) buckets.tomorrow.push(m);
    else if (when < weekEnd) buckets.thisWeek.push(m);
    else buckets.later.push(m);
  }
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  }
  return buckets;
}

function ThreeDotsIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM18 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-180"}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}

// Renders its dropdown through a portal into document.body, positioned by
// the trigger button's own bounding rect — several call sites live inside
// an `overflow-hidden` group card (the collapsible Weekly/One-time table
// sections below), which was clipping a plain absolutely-positioned menu
// the moment it hung past the card's edge. Same pattern as Select.jsx.
function MeetingActionsMenu({ meeting, canManage, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function position() {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 128;
      const left = Math.min(r.right - width, window.innerWidth - width - 8);
      const spaceBelow = window.innerHeight - r.bottom;
      setMenuPos(
        spaceBelow < 100
          ? { left, width, bottom: window.innerHeight - r.top + 4 }
          : { left, width, top: r.bottom + 4 }
      );
    }
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [open]);

  if (!canManage) return null;
  return (
    <div className="relative">
      <button ref={buttonRef} type="button" onClick={() => setOpen((v) => !v)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
        <ThreeDotsIcon />
      </button>
      {open && menuPos && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[201] w-32 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
            style={{ left: menuPos.left, width: menuPos.width, top: menuPos.top, bottom: menuPos.bottom }}
          >
            <button type="button" onClick={() => { setOpen(false); onEdit(meeting); }} className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
              Edit
            </button>
            <button type="button" onClick={() => { setOpen(false); onDelete(meeting.id); }} className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
              Delete
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// Shown next to the title wherever a meeting appears in this list —
// reflects the real `meeting.status` from the backend (kept fresh by the
// background poll below), never a value computed/guessed on the frontend.
function StatusBadge({ status }) {
  if (status === "ongoing") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        In Progress
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
        Paused
      </span>
    );
  }
  return null;
}

function UpcomingRow({ meeting, onOpen, canManage, onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link to={`/meetings/${meeting.id}`} className="truncate text-sm font-semibold text-blue-700 hover:underline">
            {meeting.title}
          </Link>
          <StatusBadge status={meeting.status} />
        </div>
        <p className="text-xs text-slate-500">{fmtScheduleLine(meeting)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => onOpen(meeting)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">
          Join
        </button>
        <MeetingActionsMenu meeting={meeting} canManage={canManage} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

function UpcomingSection({ title, meetings, defaultOpen, tone, emptyLabel, onOpen, canManage, onEdit, onDelete }) {
  const [open, setOpen] = useState(defaultOpen);
  if (meetings.length === 0 && !emptyLabel) return null;
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-bold ${
          tone === "primary" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800"
        }`}
      >
        <span>{title} ({meetings.length})</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        meetings.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">{emptyLabel}</p>
        ) : (
          <div>
            {meetings.map((m) => (
              <UpcomingRow key={m.id} meeting={m} onOpen={onOpen} canManage={canManage} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function AttendeeAvatars({ participants }) {
  if (!participants || participants.length === 0) return <span className="text-xs text-slate-300">—</span>;
  const shown = participants.slice(0, 3);
  return (
    <div className="flex -space-x-1.5">
      {shown.map((p) => (
        <span key={p.id} className="ring-2 ring-white rounded-full">
          <Avatar name={p.user?.full_name || p.user?.email || "?"} size="h-6 w-6" />
        </span>
      ))}
      {participants.length > shown.length && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600 ring-2 ring-white">
          +{participants.length - shown.length}
        </span>
      )}
    </div>
  );
}

function AllMeetingsRow({ meeting, onOpen, canManage, onEdit, onDelete }) {
  const todoCount = meeting.meeting_tasks?.length || 0;
  return (
    <tr className="border-b border-slate-100 last:border-b-0 odd:bg-white even:bg-slate-50/60 hover:bg-slate-50">
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link to={`/meetings/${meeting.id}`} className="block truncate text-left text-sm font-semibold text-blue-700 hover:underline">
            {meeting.title}
          </Link>
          <StatusBadge status={meeting.status} />
        </div>
        <p className="text-xs text-slate-500">{fmtScheduleLine(meeting)}</p>
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          To-Dos
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700">
            {todoCount}
          </span>
        </span>
      </td>
      <td className="px-4 py-3">
        <AttendeeAvatars participants={meeting.participants} />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <button type="button" onClick={() => onOpen(meeting)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">
            Join
          </button>
          <MeetingActionsMenu meeting={meeting} canManage={canManage} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </td>
    </tr>
  );
}

// Meetings don't have a real recurring-occurrence series in this app (each
// row is one scheduled instance; `recurrence` is descriptive metadata) —
// grouping here is by that cadence, not by a shared series identity.
function groupByRecurrence(meetings) {
  const weekly = meetings.filter((m) => m.recurrence === "weekly");
  const oneTime = meetings.filter((m) => m.recurrence !== "weekly");
  const groups = [];
  if (weekly.length) groups.push({ key: "weekly", label: "Weekly", meetings: weekly });
  if (oneTime.length) groups.push({ key: "one_time", label: "One-time", meetings: oneTime });
  return groups;
}

function AllMeetingsGroup({ group, onOpen, canManage, onEdit, onDelete }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between bg-slate-100 px-4 py-2.5 text-left text-sm font-bold text-slate-800"
      >
        <span>{group.label} ({group.meetings.length})</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Meeting</th>
                <th className="px-4 py-2.5">To-Dos</th>
                <th className="px-4 py-2.5">Attendees</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {group.meetings.map((m) => (
                <AllMeetingsRow key={m.id} meeting={m} onOpen={onOpen} canManage={canManage} onEdit={onEdit} onDelete={onDelete} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MeetingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  // Admin/Owner, Team Manager, or Project Manager (role or granted flag) —
  // matches the same "management tier" idiom used everywhere else in this
  // app (tenant.is_manager_or_above / has_project_manager_access on the
  // backend). Plain team members and clients can join/view but not create.
  const canManage = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin
    || user?.role === "team_manager" || user?.is_team_manager
    || user?.role === "project_manager" || user?.is_project_manager;

  const [meetings, setMeetings] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("mine"); // "mine" | "all"
  const [liveMeeting, setLiveMeeting] = useState(null);
  const [editingMeeting, setEditingMeeting] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await meetingApi.list();
      setMeetings(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.message || "Failed to load meetings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    teamApi.list().then(setTeams).catch(() => {});
  }, []);

  // Background refresh — a meeting's status (scheduled → ongoing → paused
  // → completed) can change at any moment because someone else started,
  // paused, or ended it, and this list otherwise only ever loaded once on
  // mount. Quiet: doesn't touch `loading`/the skeleton, just swaps in
  // fresh data so the IN PROGRESS badge (and everything else here) stays
  // live without a manual page refresh.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const data = await meetingApi.list();
        if (Array.isArray(data)) setMeetings(data);
      } catch {
        // transient poll failure — stay silent, next tick will retry
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // The live meeting panel is keyed off a `?live=<id>` URL param, not just
  // in-memory state — otherwise refreshing the page while in a meeting
  // (or having joined_at set, then reloading) drops you straight back to
  // the meetings list with no way back in, which reads as "I got removed
  // from the meeting" even though attendance itself was never touched
  // server-side. Restoring always re-fetches the meeting fresh rather than
  // trusting whatever was in the (possibly stale) `meetings` list array.
  const liveMeetingId = searchParams.get("live");
  useEffect(() => {
    if (!liveMeetingId || liveMeeting?.id === Number(liveMeetingId)) return;
    meetingApi.get(liveMeetingId).then(setLiveMeeting).catch(() => {
      toast.error("That meeting is no longer available.");
      setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("live"); return next; }, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMeetingId]);

  function openLiveMeeting(meeting) {
    setLiveMeeting(meeting);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("live", meeting.id); return next; });
  }

  function closeLiveMeeting() {
    setLiveMeeting(null);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("live"); return next; });
  }

  function handleUpdate(updated) {
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
    if (liveMeeting?.id === updated.id) setLiveMeeting((current) => ({ ...current, ...updated }));
  }

  async function handleEditSave(payload) {
    const updated = await meetingApi.update(editingMeeting.id, payload);
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    toast.success("Meeting updated.");
  }

  async function handleDelete(id) {
    if (!(await confirm({ message: "Delete this meeting?", tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await meetingApi.delete(id);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      toast.success("Meeting deleted.");
    } catch (err) {
      toast.error(err.message || "Unable to delete meeting.");
    }
  }

  // The backend already restricts the list it returns to plain team
  // members/clients to exactly what they organize or were added to as an
  // attendee (see list_meetings's access scoping) — so for them "My
  // Meetings" and "All Meetings" are always the identical set, and the
  // toggle is dead UI. They just get one "All Meetings" section, no tab
  // switcher, matching "Team Members should only see an All Meetings
  // section containing meetings where they have been added as an attendee."
  const visibleMeetings = useMemo(() => {
    if (!canManage || scope === "all") return meetings;
    return meetings.filter((m) => m.organizer_id === user?.id || m.participants?.some((p) => p.user_id === user?.id));
  }, [meetings, scope, user?.id, canManage]);

  const upcoming = useMemo(() => bucketUpcoming(visibleMeetings), [visibleMeetings]);
  const groups = useMemo(() => groupByRecurrence(visibleMeetings), [visibleMeetings]);

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        {canManage ? (
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {[{ id: "mine", label: "My Meetings" }, { id: "all", label: "All Meetings" }].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setScope(tab.id)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  scope === tab.id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : (
          <h1 className="text-lg font-bold text-slate-900">All Meetings</h1>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => navigate("/meetings/new")}
            className="flex w-fit items-center gap-1.5 rounded-xl bg-orange-400 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-500"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-4a1 1 0 00-1 1v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Create Meeting
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[340px_1fr]">
          {/* ── Left: Upcoming Meetings ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Upcoming Meetings</p>
            <UpcomingSection
              title="Today" meetings={upcoming.today} defaultOpen tone="primary"
              emptyLabel="You currently have no meetings today."
              onOpen={openLiveMeeting} canManage={canManage} onEdit={setEditingMeeting} onDelete={handleDelete}
            />
            <UpcomingSection
              title="Tomorrow" meetings={upcoming.tomorrow} defaultOpen
              onOpen={openLiveMeeting} canManage={canManage} onEdit={setEditingMeeting} onDelete={handleDelete}
            />
            <UpcomingSection
              title="This Week" meetings={upcoming.thisWeek} defaultOpen={false}
              onOpen={openLiveMeeting} canManage={canManage} onEdit={setEditingMeeting} onDelete={handleDelete}
            />
            <UpcomingSection
              title="Later" meetings={upcoming.later} defaultOpen={false}
              onOpen={openLiveMeeting} canManage={canManage} onEdit={setEditingMeeting} onDelete={handleDelete}
            />
          </section>

          {/* ── Right: All Meetings, grouped ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-lg font-bold text-slate-900">
              {canManage && scope === "mine" ? "All My Meetings" : "All Meetings"} ({visibleMeetings.length})
            </p>
            {visibleMeetings.length === 0 ? (
              <div className="py-16 text-center">
                <svg className="mx-auto h-12 w-12 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                </svg>
                <p className="mt-2 text-sm font-medium text-slate-500">No meetings found</p>
                <p className="mt-1 text-xs text-slate-400">Create one — it doesn't need to belong to a team.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <AllMeetingsGroup key={g.key} group={g} onOpen={openLiveMeeting} canManage={canManage} onEdit={setEditingMeeting} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {editingMeeting && (
        <CreateMeetingModal
          teams={teams}
          teamMembers={[]}
          meeting={editingMeeting}
          onSave={handleEditSave}
          onClose={() => setEditingMeeting(null)}
        />
      )}

      {liveMeetingId && liveMeeting && (
        <LiveMeetingPanel
          meeting={liveMeeting}
          canManage={canManage}
          onUpdate={handleUpdate}
          onClose={closeLiveMeeting}
        />
      )}
    </div>
  );
}
