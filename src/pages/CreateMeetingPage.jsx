import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import DatePicker from "../components/DatePicker";
import Select from "../components/Select";
import { meetingApi } from "../api/meetingApi";
import { userApi } from "../api/userApi";
import { useAuth } from "../context/AuthContext";
import { Avatar, AgendaSectionIcon } from "../components/meetings/meetingHelpers";
import { MEETING_TYPE_PRESETS } from "../components/meetings/meetingConstants";

const MEETING_TYPE_CARDS = Object.entries(MEETING_TYPE_PRESETS).map(([value, preset]) => ({ value, ...preset }));

const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

function fmtMinutes(mins) {
  if (!mins) return "0 min";
  if (mins % 60 === 0) return `${mins / 60} hr${mins > 60 ? "s" : ""}`;
  if (mins > 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins} min`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtHourMinute(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}

function recurrenceOptions(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : null;
  const weekday = d ? WEEKDAYS[d.getDay()] : "the day you pick";
  return [
    { value: "weekly", label: `Repeat every ${weekday}` },
    { value: "none", label: "Meet as needed (no set schedule)" },
  ];
}

function scheduleSummary(dateStr, timeStr, recurrence) {
  if (!dateStr || !timeStr) return "Pick a date and time below";
  const d = new Date(`${dateStr}T00:00:00`);
  const weekday = WEEKDAYS[d.getDay()];
  const monthDay = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const time = fmtHourMinute(timeStr);
  if (recurrence === "weekly") return `${weekday}s at ${time} starting ${monthDay}`;
  return `Meet as needed — first on ${weekday}, ${monthDay} at ${time}`;
}

let localIdCounter = 0;
function nextLocalId() {
  localIdCounter += 1;
  return `local-${localIdCounter}`;
}

function withLocalIds(sections) {
  return sections.map((s) => ({ ...s, id: nextLocalId() }));
}

// ─── Create Meeting — dedicated full page (not a modal), matching the
// Level 10 Meeting-style builder: pick a meeting type, add attendees, name
// and schedule it on the left; watch the agenda build itself live on the
// right. Editing an existing meeting still uses the original
// CreateMeetingModal — this page is create-only. ─────────────────────────
// Only Owner/Admin, Team Manager, or Project Manager (role or granted flag)
// can create a meeting — matches the same gate on the "Create Meeting"
// button in MeetingsPage.jsx, re-checked here in case someone navigates to
// this URL directly instead of clicking that button.
function canCreateMeetings(user) {
  return Boolean(
    user?.role === "owner" || user?.role === "admin" || user?.is_org_admin
    || user?.role === "team_manager" || user?.is_team_manager
    || user?.role === "project_manager" || user?.is_project_manager
  );
}

export default function CreateMeetingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user && !canCreateMeetings(user)) {
      toast.error("You don't have permission to create meetings.");
      navigate("/meetings", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const [meetingType, setMeetingType] = useState("level_10");
  const [agendaSections, setAgendaSections] = useState(() => withLocalIds(MEETING_TYPE_PRESETS.level_10.agenda));

  const [orgUsers, setOrgUsers] = useState([]);
  const [attendeeIds, setAttendeeIds] = useState(() => (user?.id ? [user.id] : []));
  const [attendeeToAdd, setAttendeeToAdd] = useState("");

  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState("");
  const [checkingTitle, setCheckingTitle] = useState(false);
  const titleCheckTimer = useRef(null);

  const [dateStr, setDateStr] = useState(todayIso());
  const [timeStr, setTimeStr] = useState("09:00");
  const [recurrence, setRecurrence] = useState("weekly");

  const [saving, setSaving] = useState(false);

  const dragItem = useRef(null);
  const dragOver = useRef(null);

  useEffect(() => {
    userApi.list().then(setOrgUsers).catch(() => {});
  }, []);

  function selectMeetingType(value) {
    setMeetingType(value);
    setAgendaSections(withLocalIds(MEETING_TYPE_PRESETS[value].agenda));
  }

  // Live "this name is taken" check, debounced — the authoritative check
  // still happens again at submit (see handleSubmit) in case of a race.
  // `checkingTitle` is set eagerly in the title input's onChange (below),
  // not here, so this effect only ever sets state from inside the timeout
  // callback rather than synchronously in the effect body.
  useEffect(() => {
    if (titleCheckTimer.current) clearTimeout(titleCheckTimer.current);
    const trimmed = title.trim();
    if (!trimmed) return;
    titleCheckTimer.current = setTimeout(async () => {
      try {
        const { exists } = await meetingApi.checkTitle(trimmed);
        setTitleError(exists ? "This Meeting Name exists in your organization. Please select a different name." : "");
      } catch {
        // Non-fatal — the authoritative check at submit still catches it.
      } finally {
        setCheckingTitle(false);
      }
    }, 400);
    return () => clearTimeout(titleCheckTimer.current);
  }, [title]);

  const attendees = useMemo(
    () => attendeeIds.map((id) => orgUsers.find((u) => u.id === id)).filter(Boolean),
    [attendeeIds, orgUsers]
  );
  const availableToAdd = useMemo(
    () => orgUsers.filter((u) => !attendeeIds.includes(u.id)),
    [orgUsers, attendeeIds]
  );

  function addAttendee(idStr) {
    const id = Number(idStr);
    if (!id || attendeeIds.includes(id)) return;
    setAttendeeIds((prev) => [...prev, id]);
    setAttendeeToAdd("");
  }

  function removeAttendee(id) {
    if (id === user?.id) return; // the organizer can't remove themselves
    setAttendeeIds((prev) => prev.filter((aid) => aid !== id));
  }

  function updateSection(id, patch) {
    setAgendaSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function deleteSection(id) {
    setAgendaSections((prev) => prev.filter((s) => s.id !== id));
  }

  function addSection() {
    setAgendaSections((prev) => [...prev, { id: nextLocalId(), key: null, title: "New Section", duration_minutes: 5 }]);
  }

  function handleDrop() {
    const from = dragItem.current;
    const to = dragOver.current;
    dragItem.current = null;
    dragOver.current = null;
    if (from === null || to === null || from === to) return;
    setAgendaSections((prev) => {
      const reordered = [...prev];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      return reordered;
    });
  }

  const totalMinutes = useMemo(
    () => agendaSections.reduce((sum, s) => sum + (Number(s.duration_minutes) || 0), 0),
    [agendaSections]
  );

  const trimmedTitle = title.trim();
  const canSubmit = Boolean(trimmedTitle) && Boolean(dateStr) && Boolean(timeStr) && !titleError && !checkingTitle && !saving;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!trimmedTitle) {
      toast.error("Meeting name is required.");
      return;
    }
    if (!dateStr || !timeStr) {
      toast.error("Date and time are required.");
      return;
    }
    setSaving(true);
    try {
      await meetingApi.create({
        title: trimmedTitle,
        scheduled_at: new Date(`${dateStr}T${timeStr}`).toISOString(),
        duration_minutes: totalMinutes || 60,
        meeting_type: meetingType,
        // Priority/Visibility aren't surfaced on this page — sensible,
        // invisible defaults; still fully editable later via Edit Meeting.
        priority: "medium",
        visibility: "organization",
        recurrence,
        team_id: null,
        organizer_id: user?.id ?? null,
        participant_ids: attendeeIds,
        agenda_items: agendaSections
          .filter((s) => s.title.trim())
          .map((s, i) => ({ title: s.title.trim(), duration_minutes: s.duration_minutes || null, sort_order: i })),
      });
      toast.success("Meeting created.");
      navigate("/meetings");
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes("meeting name exists")) {
        setTitleError(err.message);
      } else {
        toast.error(err.message || "Unable to create meeting.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 lg:flex-row lg:gap-10 lg:px-8">
      {/* ── Left: Setup form ── */}
      <div className="w-full lg:w-[420px] lg:shrink-0">
        <button
          type="button"
          onClick={() => navigate("/meetings")}
          className="mb-4 flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Back
        </button>
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Create Meeting</h1>

        {/* Meeting Type */}
        <div className="mb-6">
          <p className="mb-2 text-sm font-semibold text-slate-700">Meeting Type</p>
          <div className="grid grid-cols-2 gap-3">
            {MEETING_TYPE_CARDS.map((card) => (
              <button
                key={card.value}
                type="button"
                onClick={() => selectMeetingType(card.value)}
                className={`rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                  meetingType === card.value
                    ? "border-orange-400 bg-orange-50/40"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <p className="text-sm font-semibold text-slate-800">{card.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{card.durationLabel}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Attendees */}
        <div className="mb-6">
          <label className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700">
            Attendees
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] text-slate-400" title="Everyone invited to this meeting">?</span>
          </label>
          <Select
            value={attendeeToAdd}
            onChange={(e) => addAttendee(e.target.value)}
            className="w-full px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-500"
          >
            <option value="">Select Attendee to Add</option>
            {availableToAdd.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
            ))}
          </Select>

          <div className="mt-3 space-y-2">
            {attendees.map((a) => {
              const isOwner = a.id === user?.id;
              return (
                <div key={a.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
                  <Avatar name={a.full_name || a.email} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-slate-900">{a.full_name}</span>
                      {isOwner && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Meeting Owner
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-400">{a.email}</p>
                  </div>
                  {!isOwner && (
                    <button type="button" onClick={() => removeAttendee(a.id)} className="shrink-0 text-slate-300 hover:text-red-500">
                      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Meeting Name */}
        <div className="mb-6">
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">Meeting Name <span className="text-red-500">*</span></label>
          <input
            value={title}
            onChange={(e) => {
              const value = e.target.value;
              setTitle(value);
              if (value.trim()) {
                setCheckingTitle(true);
              } else {
                setTitleError("");
                setCheckingTitle(false);
              }
            }}
            required
            placeholder="e.g. Weekly Meeting Pulse"
            className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
              titleError ? "border-red-400 focus:ring-red-300" : "border-slate-200 focus:ring-teal-500"
            }`}
          />
          {titleError && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              {titleError}
            </p>
          )}
        </div>

        {/* Schedule */}
        <div className="mb-2">
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">First Meeting &amp; Schedule <span className="text-red-500">*</span></label>
          <div className="grid grid-cols-2 gap-3">
            <DatePicker value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            <input
              type="time"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <Select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            className="mt-3 w-full px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-500"
          >
            {recurrenceOptions(dateStr).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>

        <p className="mb-6 text-xs text-slate-400">*Required Fields</p>
      </div>

      <div className="hidden w-px self-stretch bg-slate-200 lg:block" />

      {/* ── Right: Live agenda preview ── */}
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center pt-2 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.98 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-900">{trimmedTitle || "Untitled Meeting"}</h2>
          <p className="mt-1 text-sm font-medium text-blue-600">{scheduleSummary(dateStr, timeStr, recurrence)}</p>

          <p className="mb-4 mt-8 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Agenda ({fmtMinutes(totalMinutes)})
          </p>

          <div className="w-full max-w-md space-y-1">
            {agendaSections.map((section, idx) => (
              <div
                key={section.id}
                draggable
                onDragStart={() => { dragItem.current = idx; }}
                onDragEnter={() => { dragOver.current = idx; }}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50"
              >
                <svg className="h-4 w-4 shrink-0 cursor-grab text-slate-300" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7 2a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM7 8a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zm-6 6a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4z" />
                </svg>
                <span className="shrink-0 text-slate-400">
                  <AgendaSectionIcon sectionKey={section.key} />
                </span>
                <input
                  value={section.title}
                  onChange={(e) => updateSection(section.id, { title: e.target.value })}
                  className="flex-1 truncate bg-transparent text-left text-xs font-bold uppercase tracking-wide text-slate-700 focus:outline-none"
                />
                <Select
                  value={String(section.duration_minutes ?? 5)}
                  onChange={(e) => updateSection(section.id, { duration_minutes: Number(e.target.value) })}
                  className="w-20 !border-0 !bg-transparent px-2 py-1 text-xs font-medium text-slate-500 hover:!bg-slate-100"
                  hideChevron={false}
                >
                  {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}
                </Select>
                <button
                  type="button"
                  onClick={() => deleteSection(section.id)}
                  className="shrink-0 text-slate-300 opacity-0 hover:text-red-500 group-hover:opacity-100"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zm-1 7a1 1 0 012 0v4a1 1 0 11-2 0V9zm4 0a1 1 0 012 0v4a1 1 0 11-2 0V9z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <button type="button" onClick={addSection} className="mt-4 flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add Section
          </button>
        </div>

        <div className="mt-8 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
          {titleError && <p className="mr-auto text-sm text-red-500">Please rename your meeting.</p>}
          <button type="button" onClick={() => navigate("/meetings")} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-xl bg-orange-400 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create Meeting"}
          </button>
        </div>
      </div>
    </form>
  );
}
