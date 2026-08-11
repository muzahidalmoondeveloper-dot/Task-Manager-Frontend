import { useEffect, useRef, useState, useCallback } from "react";
import Select from "../components/Select";
import toast from "react-hot-toast";
import { meetingApi } from "../api/meetingApi";
import { userApi } from "../api/userApi";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import CreateMeetingModal from "../components/meetings/CreateMeetingModal";
import { Avatar } from "../components/meetings/meetingHelpers";
import { MEETING_TYPES, AVATAR_COLORS, fmtDateTime, fmtDuration, getInitials } from "../components/meetings/meetingConstants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  scheduled: { label: "Scheduled", cls: "bg-sky-100 text-sky-700" },
  ongoing: { label: "Ongoing", cls: "bg-emerald-100 text-emerald-700" },
  paused: { label: "Paused", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", cls: "bg-slate-100 text-slate-600" },
};

const PRIORITY_LABELS = ["None", "Low", "Medium", "High", "Urgent"];
const PRIORITY_VALUES = ["none", "low", "medium", "high", "urgent"];

function AttendanceAvatar({ name, joined, onClick, disabled, title }) {
  const idx = name ? name.charCodeAt(0) % AVATAR_COLORS.length : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-opacity ${disabled ? "cursor-default" : "hover:opacity-90"}`}
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-full text-white ${joined ? AVATAR_COLORS[idx] : "bg-slate-300"}`}>
        {getInitials(name)}
      </span>
      {joined && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />
      )}
    </button>
  );
}

function SpeakingOrderAvatar({ name, state, onClick }) {
  // state: "current" | "flashing" | "done" | "skipped" | "waiting"
  const idx = name ? name.charCodeAt(0) % AVATAR_COLORS.length : 0;
  const ringCls =
    state === "current" ? "border-emerald-500" :
    state === "flashing" ? "border-amber-400 animate-pulse" :
    "border-transparent";
  const bgCls = state === "current" || state === "flashing" ? AVATAR_COLORS[idx] : "bg-slate-300";
  const label =
    state === "current" ? "Speak now. Click when done." :
    state === "flashing" ? "Selecting…" :
    state === "done" ? "Spoke" :
    state === "skipped" ? "Skipped" : "Waiting";
  const labelCls =
    state === "current" ? "text-emerald-600" :
    state === "flashing" ? "text-amber-600" :
    state === "skipped" ? "text-slate-400 italic" :
    "text-slate-400";

  return (
    <div className="flex w-24 flex-col items-center gap-1.5 text-center">
      <button
        type="button"
        onClick={onClick}
        disabled={state !== "current"}
        className={`relative flex h-16 w-16 items-center justify-center rounded-full border-4 transition-all ${ringCls} ${state === "current" ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className={`flex h-14 w-14 items-center justify-center rounded-full text-sm font-semibold text-white ${bgCls}`}>
          {getInitials(name)}
        </span>
        {state === "current" && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-white bg-emerald-500" />
        )}
      </button>
      <p className="max-w-full truncate text-xs font-medium text-slate-700">{name}</p>
      <p className={`text-[11px] font-medium ${labelCls}`}>{label}</p>
    </div>
  );
}

// ─── Drag & Drop reorder for agenda ──────────────────────────────────────────

function AgendaList({ items, onUpdate, onDelete, onReorder, canManage, liveMeetingId, currentItemId }) {
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  function handleDragStart(idx) { dragItem.current = idx; }
  function handleDragEnter(idx) { dragOver.current = idx; }

  function handleDrop() {
    const from = dragItem.current;
    const to = dragOver.current;
    if (from === null || to === null || from === to) return;
    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const withOrder = reordered.map((item, i) => ({ ...item, sort_order: i }));
    onReorder(withOrder);
    dragItem.current = null;
    dragOver.current = null;
  }

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <AgendaItem
          key={item.id}
          item={item}
          idx={idx}
          canManage={canManage}
          isLive={liveMeetingId != null}
          isCurrent={item.id === currentItemId}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDragStart={() => handleDragStart(idx)}
          onDragEnter={() => handleDragEnter(idx)}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}

function AgendaItem({ item, canManage, isLive, isCurrent, onUpdate, onDelete, onDragStart, onDragEnter, onDrop }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [dur, setDur] = useState(String(item.duration_minutes || ""));

  const STATUS_CYCLE = { pending: "in_progress", in_progress: "done", done: "pending" };
  const STATUS_CLS = {
    pending: "bg-slate-100 text-slate-600",
    in_progress: "bg-sky-100 text-sky-700",
    done: "bg-emerald-100 text-emerald-700",
  };

  function save() {
    onUpdate(item.id, { title, duration_minutes: dur ? Number(dur) : null });
    setEditing(false);
  }

  return (
    <div
      draggable={canManage}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-2 shadow-sm ${
        isCurrent ? "border-teal-400 ring-1 ring-teal-200" : "border-slate-200"
      }`}
    >
      {isCurrent && (
        <span className="shrink-0 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
          Current
        </span>
      )}
      {canManage && (
        <svg className="h-4 w-4 shrink-0 cursor-grab text-slate-300" viewBox="0 0 20 20" fill="currentColor">
          <path d="M7 2a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM7 8a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zm-6 6a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4z" />
        </svg>
      )}

      {editing ? (
        <>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
            autoFocus
          />
          <input
            type="number"
            value={dur}
            onChange={(e) => setDur(e.target.value)}
            placeholder="min"
            className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm"
          />
          <button onClick={save} className="rounded-lg bg-teal-600 px-3 py-1 text-xs text-white hover:bg-teal-700">Save</button>
          <button onClick={() => setEditing(false)} className="rounded-lg px-3 py-1 text-xs text-slate-500 hover:bg-slate-100">Cancel</button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-slate-800">{item.title}</span>
          {item.duration_minutes && (
            <span className="text-xs text-slate-400">{fmtDuration(item.duration_minutes)}</span>
          )}
          <button
            onClick={() => onUpdate(item.id, { status: STATUS_CYCLE[item.status] || "pending" })}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[item.status] || STATUS_CLS.pending}`}
          >
            {item.status === "in_progress" ? "In Progress" : item.status === "done" ? "Done" : "Pending"}
          </button>
          {canManage && (
            <>
              <button onClick={() => setEditing(true)} className="text-slate-400 hover:text-slate-600">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              <button onClick={() => onDelete(item.id)} className="text-slate-400 hover:text-red-500">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zm-1 7a1 1 0 012 0v4a1 1 0 11-2 0V9zm4 0a1 1 0 012 0v4a1 1 0 11-2 0V9z" clipRule="evenodd" />
                </svg>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}


// ─── Score Modal (Wrap Up) ────────────────────────────────────────────────────

function ScoreModal({ participant, onClose, onSubmit }) {
  const [score, setScore] = useState(participant.score != null ? String(participant.score) : "");
  const [note, setNote] = useState(participant.score_note || "");
  const [saving, setSaving] = useState(false);
  const numericScore = Number(score);
  const isValid = score !== "" && !Number.isNaN(numericScore) && numericScore >= 1 && numericScore <= 10;

  async function handleSubmit() {
    if (!isValid) {
      toast.error("Enter a score between 1 and 10.");
      return;
    }
    setSaving(true);
    await onSubmit(Math.round(numericScore * 10) / 10, note.trim());
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Rate this meeting</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          <p className="mb-3 text-sm text-slate-600">
            Submit a score for {participant.user?.full_name || participant.user?.email}.
          </p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(String(n))}
                className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                  Number(score) === n
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {n}
              </button>
            ))}
            <input
              type="text"
              inputMode="decimal"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="7.8"
              className="h-9 w-16 rounded-lg border border-slate-300 px-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-400">Use up to one decimal place, for example 7.8.</p>

          <label className="mb-1.5 mt-4 block text-sm font-medium text-slate-700">Motivation for that score (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Share quick feedback for the team…"
            className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving || !isValid}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {saving ? "Submitting…" : "Submit rating"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Live Meeting Panel ───────────────────────────────────────────────────────

// Exported (alongside MeetingCard/SummaryModal below) so the org-wide
// MeetingsPage can reuse the exact same live-meeting experience — agenda,
// notes, decisions, check-in roulette, join toggle — instead of duplicating
// ~700 lines of it. Self-contained: only reads the `meeting` prop and its
// own hooks/meetingApi calls, no dependency on MeetingsTab's own state.
// Meetings aren't team-specific, so no team_id is needed here at all.
export function LiveMeetingPanel({ meeting, canManage, onUpdate, onClose }) {
  const { user } = useAuth();
  const [elapsed, setElapsed] = useState(0);
  const [newAgendaTitle, setNewAgendaTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [decisionContent, setDecisionContent] = useState("");
  const [taskName, setTaskName] = useState("");
  const [activeSection, setActiveSection] = useState("agenda");
  const [checkinSpinning, setCheckinSpinning] = useState(false);
  const [checkinFlashId, setCheckinFlashId] = useState(null);
  const [manualSpeakerId, setManualSpeakerId] = useState("");
  const [scoringFor, setScoringFor] = useState(null); // participant object whose score modal is open
  const [orgUsers, setOrgUsers] = useState([]);
  const [addParticipantId, setAddParticipantId] = useState("");
  const [addingParticipant, setAddingParticipant] = useState(false);
  const autoSaveTimer = useRef(null);
  const savedNoteId = useRef(null);
  const checkinSpinningRef = useRef(false);
  useEffect(() => { checkinSpinningRef.current = checkinSpinning; }, [checkinSpinning]);

  // Org-wide member list to add participants from — a meeting isn't
  // team-specific, so this isn't limited to one team's roster.
  useEffect(() => {
    if (!canManage) return;
    userApi.list().then(setOrgUsers).catch(() => {});
  }, [canManage]);

  // Near-real-time sync: while this panel is open, poll for changes made by
  // anyone else viewing the same meeting (attendance, speaking order, agenda,
  // notes, decisions), so updates don't require a manual page refresh. No
  // websocket/SSE infra exists in this app; this mirrors the only existing
  // real-time-ish pattern (the notifications poll in AppLayout.jsx).
  useEffect(() => {
    const id = setInterval(async () => {
      if (checkinSpinningRef.current) return; // don't clobber the shuffle animation mid-spin
      try {
        const fresh = await meetingApi.get(meeting.id);
        onUpdate(fresh);
      } catch {
        // transient poll failure — stay silent, next tick will retry
      }
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id]);

  // Timer
  useEffect(() => {
    if (meeting.status !== "ongoing") return;
    const start = meeting.started_at ? new Date(meeting.started_at).getTime() : Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [meeting.status, meeting.started_at]);

  function fmtElapsed(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  const totalDurSecs = meeting.duration_minutes * 60;
  const progress = Math.min(100, (elapsed / totalDurSecs) * 100);

  async function lifecycle(action) {
    try {
      const updated = await meetingApi[action](meeting.id);
      onUpdate(updated);
    } catch (err) {
      toast.error(err.message || "Action failed");
    }
  }

  async function toggleJoined(participant) {
    const joined = !participant.joined_at;
    try {
      const updated = await meetingApi.setParticipantJoined(meeting.id, participant.user_id, joined);
      onUpdate({
        ...meeting,
        participants: meeting.participants.map((p) => (p.id === updated.id ? updated : p)),
      });
    } catch {
      toast.error("Failed to update attendance");
    }
  }

  const availableToAdd = orgUsers.filter(
    (u) => !meeting.participants.some((p) => p.user_id === u.id)
  );

  async function addParticipant() {
    if (!addParticipantId) return;
    setAddingParticipant(true);
    try {
      // No dedicated "add one participant" endpoint — update_meeting
      // replaces the whole list, so send the existing ids plus the new one.
      const nextIds = [...meeting.participants.map((p) => p.user_id).filter(Boolean), Number(addParticipantId)];
      const updated = await meetingApi.update(meeting.id, { participant_ids: nextIds });
      onUpdate(updated);
      setAddParticipantId("");
      toast.success("Participant added.");
    } catch (err) {
      toast.error(err.message || "Failed to add participant.");
    } finally {
      setAddingParticipant(false);
    }
  }

  async function removeParticipant(participant) {
    try {
      const nextIds = meeting.participants
        .filter((p) => p.id !== participant.id)
        .map((p) => p.user_id)
        .filter(Boolean);
      const updated = await meetingApi.update(meeting.id, { participant_ids: nextIds });
      onUpdate(updated);
    } catch (err) {
      toast.error(err.message || "Failed to remove participant.");
    }
  }

  const checkinPool = meeting.participants.filter((p) => p.joined_at);

  async function runSpin(apiCall) {
    if (checkinSpinning) return;
    setCheckinSpinning(true);

    const candidates = checkinPool.filter(
      (p) => !p.spoken_at && p.id !== meeting.checkin_current_participant_id
    );
    if (candidates.length > 0) {
      const flashDuration = 1100;
      const flashInterval = setInterval(() => {
        setCheckinFlashId(candidates[Math.floor(Math.random() * candidates.length)].id);
      }, 120);
      await new Promise((resolve) => setTimeout(resolve, flashDuration));
      clearInterval(flashInterval);
    }
    setCheckinFlashId(null);

    try {
      const updated = await apiCall();
      onUpdate(updated);
    } catch (err) {
      toast.error(err.message || "Failed to update speaking order.");
    } finally {
      setCheckinSpinning(false);
    }
  }

  function advanceCheckin() {
    return runSpin(() => meetingApi.checkinNext(meeting.id));
  }

  function skipCheckin() {
    return runSpin(() => meetingApi.checkinSkip(meeting.id));
  }

  async function selectSpeaker() {
    if (!manualSpeakerId) return;
    try {
      const updated = await meetingApi.checkinSelect(meeting.id, Number(manualSpeakerId));
      onUpdate(updated);
      setManualSpeakerId("");
    } catch (err) {
      toast.error(err.message || "Failed to set speaker.");
    }
  }

  async function resetCheckin() {
    try {
      const updated = await meetingApi.checkinReset(meeting.id);
      onUpdate(updated);
    } catch {
      toast.error("Failed to reset check-in.");
    }
  }

  async function advanceAgenda() {
    try {
      const updated = await meetingApi.advanceAgenda(meeting.id);
      onUpdate(updated);
    } catch {
      toast.error("Failed to advance agenda.");
    }
  }

  async function addAgendaItem() {
    if (!newAgendaTitle.trim()) return;
    try {
      const updated = await meetingApi.addAgendaItem(meeting.id, {
        title: newAgendaTitle.trim(),
        sort_order: meeting.agenda_items.length,
      });
      onUpdate({ ...meeting, agenda_items: [...meeting.agenda_items, updated] });
      setNewAgendaTitle("");
    } catch {
      toast.error("Failed to add item");
    }
  }

  async function updateAgendaItem(itemId, payload) {
    try {
      const updated = await meetingApi.updateAgendaItem(meeting.id, itemId, payload);
      onUpdate({
        ...meeting,
        agenda_items: meeting.agenda_items.map((a) => (a.id === itemId ? updated : a)),
      });
    } catch {
      toast.error("Failed to update item");
    }
  }

  async function deleteAgendaItem(itemId) {
    try {
      await meetingApi.deleteAgendaItem(meeting.id, itemId);
      onUpdate({ ...meeting, agenda_items: meeting.agenda_items.filter((a) => a.id !== itemId) });
    } catch {
      toast.error("Failed to delete item");
    }
  }

  async function reorderAgenda(newItems) {
    onUpdate({ ...meeting, agenda_items: newItems });
    try {
      await meetingApi.reorderAgenda(
        meeting.id,
        newItems.map((a) => ({ id: a.id, sort_order: a.sort_order }))
      );
    } catch {
      toast.error("Failed to reorder");
    }
  }

  // Debounced note auto-save
  function handleNoteChange(val) {
    setNoteContent(val);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      if (!val.trim()) return;
      try {
        if (savedNoteId.current) {
          await meetingApi.updateNote(meeting.id, savedNoteId.current, { content: val });
        } else {
          const note = await meetingApi.addNote(meeting.id, { content: val });
          savedNoteId.current = note.id;
          onUpdate({ ...meeting, notes: [...meeting.notes, note] });
        }
      } catch {
        // silent
      }
    }, 1500);
  }

  async function addDecision() {
    if (!decisionContent.trim()) return;
    try {
      const d = await meetingApi.addDecision(meeting.id, { content: decisionContent.trim() });
      onUpdate({ ...meeting, decisions: [...meeting.decisions, d] });
      setDecisionContent("");
    } catch {
      toast.error("Failed to add decision");
    }
  }

  async function deleteDecision(did) {
    try {
      await meetingApi.deleteDecision(meeting.id, did);
      onUpdate({ ...meeting, decisions: meeting.decisions.filter((d) => d.id !== did) });
    } catch {
      toast.error("Failed to delete decision");
    }
  }

  async function createTask() {
    if (!taskName.trim()) return;
    try {
      const mt = await meetingApi.createTask(meeting.id, { name: taskName.trim() });
      onUpdate({ ...meeting, meeting_tasks: [...meeting.meeting_tasks, mt] });
      setTaskName("");
      toast.success("Task created");
    } catch {
      toast.error("Failed to create task");
    }
  }

  const sections = [
    { id: "agenda", label: "Agenda" },
    { id: "notes", label: "Notes" },
    { id: "decisions", label: "Decisions" },
    { id: "tasks", label: "Tasks" },
    { id: "wrapup", label: "Wrap Up" },
  ];

  async function submitScore(userId, score, note) {
    try {
      const updated = await meetingApi.setParticipantScore(meeting.id, userId, score, note || null);
      onUpdate({
        ...meeting,
        participants: meeting.participants.map((p) => (p.id === updated.id ? updated : p)),
      });
      setScoringFor(null);
    } catch (err) {
      toast.error(err.message || "Failed to submit score.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/50">
      <div className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{meeting.title}</h2>
            <p className="text-sm text-slate-500">
              {MEETING_TYPES.find((t) => t.value === meeting.meeting_type)?.label}
              {" · "}
              {fmtDuration(meeting.duration_minutes)}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Timer */}
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
          <div className="flex items-center gap-4">
            <span className="font-mono text-2xl font-bold text-slate-900">{fmtElapsed(elapsed)}</span>
            <div className="flex-1">
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all ${progress > 90 ? "bg-red-500" : progress > 70 ? "bg-amber-400" : "bg-teal-500"}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-0.5 text-xs text-slate-400">{fmtDuration(meeting.duration_minutes)} planned</p>
            </div>
            <div className="flex gap-2">
              {!canManage && meeting.status !== "completed" && (
                <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500">Only the host can control this meeting.</span>
              )}
              {canManage && meeting.status === "scheduled" && (
                <button onClick={() => lifecycle("start")} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700">Start Meeting</button>
              )}
              {canManage && meeting.status === "ongoing" && (
                <>
                  <button onClick={() => lifecycle("pause")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">Pause</button>
                  <button onClick={() => lifecycle("end")} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">End</button>
                </>
              )}
              {canManage && meeting.status === "paused" && (
                <>
                  <button onClick={() => lifecycle("resume")} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700">Resume</button>
                  <button onClick={() => lifecycle("end")} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">End</button>
                </>
              )}
              {meeting.status === "completed" && (
                <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600">Completed</span>
              )}
            </div>
          </div>
        </div>

        {/* Stage 1: Attendance — shown while scheduled (always, for any meeting type).
            Renders even with zero participants (host still needs a way to add
            the first one) whenever the host can manage it. */}
        {(meeting.participants.length > 0 || canManage) && (meeting.meeting_type !== "l10" || meeting.status === "scheduled") && (() => {
          const joinedCount = meeting.participants.filter((p) => p.joined_at).length;
          const pct = meeting.participants.length ? Math.round((joinedCount / meeting.participants.length) * 100) : 0;
          return (
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Meeting Attendance</h3>
              <p className="mt-1 text-xs text-slate-500">
                Click your own avatar to join.
                {canManage && " As the host, click any attendee's avatar to check them in."}
              </p>

              {meeting.participants.length > 0 && (
                <>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {joinedCount} of {meeting.participants.length} participants joined
                    </span>
                    <span className="font-semibold text-slate-700">{pct}%</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </>
              )}

              <div className="mt-3 flex flex-wrap gap-4">
                {meeting.participants.map((p) => {
                  const isSelf = p.user_id === user?.id;
                  const canClick = isSelf || canManage;
                  return (
                    <div key={p.id} className="flex flex-col items-center gap-1">
                      <AttendanceAvatar
                        name={p.user?.full_name || p.user?.email}
                        joined={Boolean(p.joined_at)}
                        onClick={() => {
                          if (!canClick) return;
                          toggleJoined(p);
                        }}
                        disabled={!canClick}
                        title={
                          isSelf
                            ? (p.joined_at ? "Click to leave the meeting." : "Click to join the meeting.")
                            : canManage
                            ? (p.joined_at ? `${p.user?.full_name || p.user?.email} — joined. Click to check them out.` : `${p.user?.full_name || p.user?.email} — not joined. Click to check them in.`)
                            : p.user?.full_name || p.user?.email
                        }
                      />
                      {canManage && (
                        <button type="button" onClick={() => removeParticipant(p)}
                          className="text-[10px] font-medium text-slate-400 hover:text-red-500">
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {canManage && (
                <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
                  <Select value={addParticipantId} onChange={(e) => setAddParticipantId(e.target.value)}
                    className="max-w-xs flex-1 px-3 py-2 text-sm">
                    <option value="">
                      {availableToAdd.length === 0 ? "No more org members to add" : "Add a participant…"}
                    </option>
                    {availableToAdd.map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                    ))}
                  </Select>
                  <button type="button" onClick={addParticipant} disabled={!addParticipantId || addingParticipant}
                    className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                    {addingParticipant ? "Adding…" : "+ Add"}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* Stage 2: Speaking Order (L10 personal check-in) — replaces Attendance once the meeting starts */}
        {meeting.meeting_type === "l10" && meeting.status !== "scheduled" && (() => {
          const allSpoken = checkinPool.length > 0 && checkinPool.every((p) => p.spoken_at);
          const hasStarted = meeting.checkin_current_participant_id || checkinPool.some((p) => p.spoken_at);
          const remainingCandidates = checkinPool.filter(
            (p) => !p.spoken_at && p.id !== meeting.checkin_current_participant_id
          );

          return (
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Speaking Order</h3>
              <p className="mt-1 text-xs text-slate-500">
                The roulette picks who speaks next. Once that person is done, click their avatar (or Complete) to spin again for the remaining attendees.
              </p>
              {checkinPool.length === 0 ? (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No joined participants to speak.
                </p>
              ) : (
                <>
                  <div className="mt-4 flex flex-wrap gap-4">
                    {checkinPool.map((p) => {
                      const isCurrent = p.id === meeting.checkin_current_participant_id;
                      const isFlashing = checkinSpinning && p.id === checkinFlashId;
                      const state = isCurrent ? "current" : isFlashing ? "flashing" : p.spoken_at ? (p.skipped ? "skipped" : "done") : "waiting";
                      return (
                        <SpeakingOrderAvatar
                          key={p.id}
                          name={p.user?.full_name || p.user?.email}
                          state={state}
                          onClick={() => isCurrent && !checkinSpinning && advanceCheckin()}
                        />
                      );
                    })}
                  </div>
                  <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${allSpoken && !checkinSpinning ? "bg-emerald-50 font-semibold text-emerald-700" : "bg-slate-50 text-slate-500"}`}>
                    {checkinSpinning
                      ? "Picking the next speaker…"
                      : meeting.checkin_current_participant_id
                      ? "Click the highlighted avatar, or Complete, once that person has finished speaking."
                      : allSpoken
                      ? "Speaking round completed"
                      : "Start the check-in to pick the first speaker."}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!meeting.checkin_current_participant_id && !allSpoken && (
                      <button type="button" onClick={advanceCheckin} disabled={checkinSpinning}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60">
                        {checkinSpinning ? "Picking…" : "Start Check-in"}
                      </button>
                    )}
                    {meeting.checkin_current_participant_id && (
                      <>
                        <button type="button" onClick={advanceCheckin} disabled={checkinSpinning}
                          className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60">
                          Complete
                        </button>
                        <button type="button" onClick={skipCheckin} disabled={checkinSpinning}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                          Skip
                        </button>
                      </>
                    )}
                    {hasStarted && (
                      <button type="button" onClick={resetCheckin} disabled={checkinSpinning}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        Restart Round
                      </button>
                    )}
                    {allSpoken && !checkinSpinning && (
                      <button type="button" onClick={() => setActiveSection("agenda")}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                        Continue to Agenda
                      </button>
                    )}
                    {remainingCandidates.length > 0 && (
                      <div className="ml-auto flex items-center gap-1.5">
                        <Select
                          value={manualSpeakerId}
                          onChange={(e) => setManualSpeakerId(e.target.value)}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700 focus:outline-none"
                        >
                          <option value="">Pick speaker manually…</option>
                          {remainingCandidates.map((p) => (
                            <option key={p.id} value={p.user_id}>{p.user?.full_name || p.user?.email}</option>
                          ))}
                        </Select>
                        <button type="button" onClick={selectSpeaker} disabled={!manualSpeakerId || checkinSpinning}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                          Set
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* Section nav */}
        <div className="flex border-b border-slate-200 px-6">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeSection === s.id
                  ? "border-teal-600 text-teal-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {s.label}
              {s.id === "agenda" && meeting.agenda_items.length > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs">{meeting.agenda_items.length}</span>
              )}
              {s.id === "decisions" && meeting.decisions.length > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs">{meeting.decisions.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Section content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeSection === "agenda" && (
            <div className="space-y-4">
              {meeting.status !== "scheduled" && meeting.agenda_items.length > 0 && (
                <div className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 px-3 py-2">
                  <span className="text-xs text-teal-700">
                    {meeting.current_agenda_item_id
                      ? `Current: ${meeting.agenda_items.find((a) => a.id === meeting.current_agenda_item_id)?.title || "—"}`
                      : "All agenda items complete."}
                  </span>
                  {canManage && (
                    <button onClick={advanceAgenda}
                      className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700">
                      Next Agenda Item
                    </button>
                  )}
                </div>
              )}
              <AgendaList
                items={meeting.agenda_items}
                canManage={canManage}
                liveMeetingId={meeting.id}
                currentItemId={meeting.current_agenda_item_id}
                onUpdate={updateAgendaItem}
                onDelete={deleteAgendaItem}
                onReorder={reorderAgenda}
              />
              {canManage && (
                <div className="flex gap-2">
                  <input
                    value={newAgendaTitle}
                    onChange={(e) => setNewAgendaTitle(e.target.value)}
                    placeholder="New agenda item…"
                    onKeyDown={(e) => e.key === "Enter" && addAgendaItem()}
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <button onClick={addAgendaItem} className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">Add</button>
                </div>
              )}
            </div>
          )}

          {activeSection === "notes" && (
            <div className="space-y-4">
              <textarea
                value={noteContent}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder="Type meeting notes… (auto-saved)"
                rows={12}
                className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              {meeting.notes.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase text-slate-400">Saved Notes</h4>
                  {meeting.notes.map((note) => (
                    <div key={note.id} className="rounded-xl border border-slate-200 p-3">
                      <p className="whitespace-pre-wrap text-sm text-slate-700">{note.content}</p>
                      <p className="mt-1 text-xs text-slate-400">{fmtDateTime(note.updated_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSection === "decisions" && (
            <div className="space-y-4">
              <div className="space-y-2">
                {meeting.decisions.map((d) => (
                  <div key={d.id} className="flex items-start gap-2 rounded-xl border border-slate-200 p-3">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                    <p className="flex-1 text-sm text-slate-700">{d.content}</p>
                    <button onClick={() => deleteDecision(d.id)} className="text-slate-300 hover:text-red-500">
                      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={decisionContent}
                  onChange={(e) => setDecisionContent(e.target.value)}
                  placeholder="Record a decision…"
                  onKeyDown={(e) => e.key === "Enter" && addDecision()}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <button onClick={addDecision} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Add</button>
              </div>
            </div>
          )}

          {activeSection === "tasks" && (
            <div className="space-y-4">
              <div className="space-y-2">
                {meeting.meeting_tasks.map((mt) => (
                  <div key={mt.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                    <svg className="h-4 w-4 shrink-0 text-teal-500" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
                    </svg>
                    <span className="flex-1 text-sm text-slate-700">{mt.task?.name || `Task #${mt.task_id}`}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                      mt.task?.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}>{mt.task?.status || "todo"}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="Create a task…"
                  onKeyDown={(e) => e.key === "Enter" && createTask()}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <button onClick={createTask} className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">Create</button>
              </div>
            </div>
          )}

          {activeSection === "wrapup" && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Attendee scores</h4>
                <p className="mt-1 text-xs text-slate-500">Scores update as soon as attendees submit.</p>
              </div>
              {meeting.participants.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
                  No participants on this meeting.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {meeting.participants.map((p) => {
                    const isSelf = p.user_id === user?.id;
                    return (
                      <div key={p.id} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${isSelf ? "border-teal-300 bg-teal-50/40" : "border-slate-200"}`}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={p.user?.full_name || p.user?.email} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">{p.user?.full_name || p.user?.email}</p>
                            <p className="text-xs text-slate-400">{p.score != null ? `Score: ${p.score}` : "Score: Not scored yet"}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => isSelf && setScoringFor(p)}
                          disabled={!isSelf}
                          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                            isSelf ? "border-slate-300 text-slate-700 hover:bg-slate-50" : "cursor-default border-slate-100 text-slate-300"
                          }`}
                        >
                          Score
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {scoringFor && (
        <ScoreModal
          participant={scoringFor}
          onClose={() => setScoringFor(null)}
          onSubmit={(score, note) => submitScore(scoringFor.user_id, score, note)}
        />
      )}
    </div>
  );
}

// ─── Meeting Card ─────────────────────────────────────────────────────────────

export function MeetingCard({ meeting, canManage, onOpen, onEdit, onDelete }) {
  const cfg = STATUS_CONFIG[meeting.status] || STATUS_CONFIG.scheduled;
  const typeLabel = MEETING_TYPES.find((t) => t.value === meeting.meeting_type)?.label || meeting.meeting_type;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
            <span className="text-xs text-slate-400">{typeLabel}</span>
            {/* Only present on the org-wide Meetings page (OrgMeetingOut) —
                absent (undefined) within a single team's own Meetings tab,
                where it'd be redundant. */}
            {meeting.team_name && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{meeting.team_name}</span>
            )}
          </div>
          <h3 className="mt-1.5 truncate text-sm font-semibold text-slate-900">{meeting.title}</h3>
          {meeting.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{meeting.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
              </svg>
              {fmtDuration(meeting.duration_minutes)}
            </span>
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c0-.414.336-.75.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75z" clipRule="evenodd" />
              </svg>
              {fmtDateTime(meeting.scheduled_at)}
            </span>
            {meeting.participants.length > 0 && (
              <span className="flex items-center gap-1">
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7 8a3 3 0 100-6 3 3 0 000 6zM13.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                  <path d="M2.5 15.5A4.5 4.5 0 017 11h.25a4.5 4.5 0 014.5 4.5.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5z" />
                </svg>
                {meeting.participants.length}
              </span>
            )}
            {meeting.agenda_items.length > 0 && (
              <span>{meeting.agenda_items.length} agenda items</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => onOpen(meeting)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Open
          </button>
          {canManage && (
            <>
              <button onClick={() => onEdit(meeting)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              <button onClick={() => onDelete(meeting.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-500">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zm-1 7a1 1 0 012 0v4a1 1 0 11-2 0V9zm4 0a1 1 0 012 0v4a1 1 0 11-2 0V9z" clipRule="evenodd" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Summary Modal ────────────────────────────────────────────────────────────

export function SummaryModal({ meeting, onClose }) {
  const completedAgenda = meeting.agenda_items.filter((a) => a.status === "done");
  const pendingAgenda = meeting.agenda_items.filter((a) => a.status !== "done");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Meeting Summary</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="space-y-4 p-6">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{meeting.title}</h3>
            <p className="text-sm text-slate-500">{fmtDateTime(meeting.scheduled_at)} · {fmtDuration(meeting.duration_minutes)}</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-xl font-bold text-slate-900">{meeting.agenda_items.length}</p>
              <p className="text-xs text-slate-500">Agenda Items</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 text-center">
              <p className="text-xl font-bold text-emerald-700">{completedAgenda.length}</p>
              <p className="text-xs text-emerald-600">Completed</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-center">
              <p className="text-xl font-bold text-amber-700">{pendingAgenda.length}</p>
              <p className="text-xs text-amber-600">Pending</p>
            </div>
          </div>

          {meeting.decisions.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-slate-400">Decisions</h4>
              <ul className="space-y-1">
                {meeting.decisions.map((d) => (
                  <li key={d.id} className="flex gap-2 text-sm text-slate-700">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    {d.content}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {meeting.meeting_tasks.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-slate-400">Action Items</h4>
              <ul className="space-y-1">
                {meeting.meeting_tasks.map((mt) => (
                  <li key={mt.id} className="flex gap-2 text-sm text-slate-700">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                    {mt.task?.name || `Task #${mt.task_id}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {meeting.notes.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-slate-400">Notes ({meeting.notes.length})</h4>
              {meeting.notes.map((n) => (
                <div key={n.id} className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
                  <p className="whitespace-pre-wrap">{n.content}</p>
                  <p className="mt-1 text-xs text-slate-400">{fmtDateTime(n.updated_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main MeetingsTab ─────────────────────────────────────────────────────────

const FILTER_TABS = [
  { id: "", label: "All" },
  { id: "scheduled", label: "Upcoming" },
  { id: "ongoing", label: "Ongoing" },
  { id: "completed", label: "Completed" },
];

export default function MeetingsTab({ team, canManage }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [liveMeeting, setLiveMeeting] = useState(null);
  const [summaryMeeting, setSummaryMeeting] = useState(null);

  const teamMembers = team?.members || [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await meetingApi.list(filter || undefined, team.id);
      setMeetings(data);
    } catch {
      toast.error("Failed to load meetings");
    } finally {
      setLoading(false);
    }
  }, [team.id, filter]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(payload) {
    try {
      if (editing) {
        const updated = await meetingApi.update(editing.id, payload);
        setMeetings((prev) => prev.map((m) => (m.id === editing.id ? updated : m)));
        toast.success("Meeting updated");
      } else {
        const created = await meetingApi.create(payload);
        setMeetings((prev) => [created, ...prev]);
        toast.success("Meeting created");
      }
    } catch {
      toast.error("Failed to save meeting");
      throw new Error("save failed");
    }
  }

  async function handleDelete(id) {
    if (!(await confirm({ message: "Delete this meeting?", tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await meetingApi.delete(id);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      toast.success("Deleted");
    } catch {
      toast.error("Failed to delete meeting");
    }
  }

  function handleUpdate(updated) {
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    if (liveMeeting?.id === updated.id) setLiveMeeting(updated);
  }

  function handleOpen(meeting) {
    setLiveMeeting(meeting);
  }

  const filtered = meetings.filter((m) =>
    !search || m.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Meetings</h2>
          <p className="text-xs text-slate-500">Schedule, run, and track team meetings</p>
        </div>
        {canManage && (
          <button
            onClick={() => { setEditing(null); setShowModal(true); }}
            className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            New Meeting
          </button>
        )}
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === tab.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search meetings…"
            className="w-48 rounded-xl border border-slate-200 py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="mx-auto h-12 w-12 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
            </svg>
            <p className="mt-2 text-sm font-medium text-slate-500">No meetings found</p>
            {canManage && filter === "" && !search && (
              <button
                onClick={() => { setEditing(null); setShowModal(true); }}
                className="mt-3 text-sm font-medium text-teal-600 hover:underline"
              >
                Schedule your first meeting
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                canManage={canManage}
                onOpen={handleOpen}
                onEdit={(meeting) => { setEditing(meeting); setShowModal(true); }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showModal && (
        <CreateMeetingModal
          team={team}
          meeting={editing}
          teamMembers={teamMembers}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditing(null); }}
        />
      )}

      {liveMeeting && (
        <LiveMeetingPanel
          meeting={liveMeeting}
          canManage={canManage}
          onUpdate={handleUpdate}
          onClose={() => setLiveMeeting(null)}
        />
      )}

      {summaryMeeting && (
        <SummaryModal
          meeting={summaryMeeting}
          onClose={() => setSummaryMeeting(null)}
        />
      )}
    </section>
  );
}
