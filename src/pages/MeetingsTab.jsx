import { useEffect, useRef, useState, useCallback } from "react";
import Select from "../components/Select";
import toast from "react-hot-toast";
import { meetingApi } from "../api/meetingApi";
import { userApi } from "../api/userApi";
import { issueApi } from "../api/issueApi";
import { teamNewsApi } from "../api/teamNewsApi";
import { teamApi } from "../api/teamApi";
import { taskApi } from "../api/taskApi";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import CreateMeetingModal from "../components/meetings/CreateMeetingModal";
import { CreateTodoModal, NewsModal } from "./TeamDetailPage";
import { IssueModal } from "./IssuesTab";
import { Avatar, AgendaSectionIcon, FloatingReaction, AvatarReactionBadge } from "../components/meetings/meetingHelpers";
import { KpiSection, RockReviewSection, NewsSection, TodoListSection, IdsSection, ConcludeSection } from "../components/meetings/liveSections";
import { MEETING_TYPES, AVATAR_COLORS, fmtDateTime, fmtDuration, getInitials, randomReactionOffset } from "../components/meetings/meetingConstants";

// Agenda items only carry a free-text title (no stored "key") — this maps
// a Level 10-preset title back to its icon/description so the live view
// looks right whether the meeting came from a preset or was hand-built.
// Unrecognized titles (fully custom sections) fall back to a generic icon
// and no description, same as the mockup implies for a "Custom Agenda".
const SECTION_INFO = [
  { key: "segue", match: /segue|check-?in/i, description: "Share the good news, break the ice, and transition into the meeting." },
  { key: "scorecard", match: /scorecard|prior quarter|^kpi$/i, description: "Review your weekly measurables — numbers on or off track." },
  { key: "rock_review", match: /rock/i, description: "Review progress on this quarter's Rocks — on track or off track." },
  { key: "news", match: /headline|news|v\/?to/i, description: "Share customer and employee news — good or bad, worth knowing." },
  { key: "todo_list", match: /to-?do/i, description: "Review to-dos from last week — done or not done." },
  { key: "ids", match: /^ids$/i, description: "Identify, Discuss, and Solve your team's most important issues." },
  { key: "swot", match: /swot/i, description: "Assess strengths, weaknesses, opportunities, and threats." },
  { key: "feedback", match: /feedback/i, description: "Share positive and constructive feedback." },
  { key: "conclude", match: /conclude|next steps|wrap/i, description: "Recap to-dos, cascading messages, and rate the meeting." },
];

function sectionInfoForTitle(title) {
  return SECTION_INFO.find((s) => s.match.test(title || "")) || { key: null, description: null };
}

const REACTION_EMOJIS = ["👍", "👏", "❤️", "😊"];

function fmtElapsed(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Ticks up from 0 while `active`, formatted mm:ss — used for the sidebar's
// current-agenda-item countdown. Mounted with `key={agenda_item_id}` by the
// caller so switching items resets it by remounting rather than via an
// explicit "reset" effect (agenda items have no "started_at" of their own
// to derive this from — it's a live-view-only display, not persisted).
function ItemTimer({ active }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return fmtElapsed(secs);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  scheduled: { label: "Scheduled", cls: "bg-sky-100 text-sky-700" },
  ongoing: { label: "Ongoing", cls: "bg-emerald-100 text-emerald-700" },
  paused: { label: "Paused", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", cls: "bg-slate-100 text-slate-600" },
};

const PRIORITY_LABELS = ["None", "Low", "Medium", "High", "Urgent"];
const PRIORITY_VALUES = ["none", "low", "medium", "high", "urgent"];

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
  const [decisionContent, setDecisionContent] = useState("");
  const [taskName, setTaskName] = useState("");
  const [checkinSpinning, setCheckinSpinning] = useState(false);
  const [checkinFlashId, setCheckinFlashId] = useState(null);
  const [manualSpeakerId, setManualSpeakerId] = useState("");
  const [orgUsers, setOrgUsers] = useState([]);
  const [addParticipantId, setAddParticipantId] = useState("");
  const [addingParticipant, setAddingParticipant] = useState(false);
  const checkinSpinningRef = useRef(false);
  useEffect(() => { checkinSpinningRef.current = checkinSpinning; }, [checkinSpinning]);

  // ── Live-view UI state (sidebar, toolbar popovers, reactions) ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [previewItemId, setPreviewItemId] = useState(null);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const nextReactionIdRef = useRef(0); // local DOM element ids, distinct from the server's reaction feed ids below
  const lastReactionIdRef = useRef(0); // highest server reaction id already rendered — the poll's "since" cursor
  const seenReactionIdsRef = useRef(new Set()); // server reaction ids already animated (own sends + poll results)
  // Per-user avatar overlay reactions (the "who reacted" badge), keyed by
  // user_id -> { key, emoji }. `key` is bumped on every new reaction from
  // that user so AvatarReactionBadge remounts (and its animation restarts
  // from scratch) even if that user reacts again before the previous badge
  // finished fading — a plain emoji-string value wouldn't re-trigger a
  // React re-render/remount for the same user reacting with the same emoji
  // twice in a row.
  const [avatarReactions, setAvatarReactions] = useState({});
  const nextAvatarReactionKeyRef = useRef(0);
  // Toolbar create flows — each reuses the exact same modal component the
  // Team page uses (CreateTodoModal/IssueModal/NewsModal), rather than the
  // old plain-text-input popovers, per the explicit "use the existing modal
  // components" request. CreateTodoModal has no internal team picker (it
  // bakes `team.id` straight into its own payload), so To-Do specifically
  // needs a one-step team-pick before the modal can open; Issue/News already
  // have their own <Select> team pickers inside the modal, so those open
  // straight away, defaulting to the first accessible team.
  const [todoTeamPickerOpen, setTodoTeamPickerOpen] = useState(false);
  const [pickedTeamId, setPickedTeamId] = useState("");
  const [todoModalTeam, setTodoModalTeam] = useState(null);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [newsModalOpen, setNewsModalOpen] = useState(false);
  const [todoSaving, setTodoSaving] = useState(false);
  const [issueSaving, setIssueSaving] = useState(false);
  const [newsSaving, setNewsSaving] = useState(false);
  // Items created via the toolbar modals — kept here and passed down so
  // TodoListSection/IdsSection/NewsSection can show them immediately
  // without a page refresh, without needing to re-fetch or duplicate the
  // aggregation logic those sections already own.
  const [extraTeamTasks, setExtraTeamTasks] = useState([]);
  const [extraIssues, setExtraIssues] = useState([]);
  const [extraNews, setExtraNews] = useState([]);
  const [defaultTeams, setDefaultTeams] = useState([]);

  // ── Recording -> transcript -> AI task extraction ──
  // Speech-to-text runs entirely in the browser (the Web Speech API) — no
  // audio is ever uploaded, and no specific transcription/LLM vendor is
  // hardcoded here. Once recording stops, the accumulated transcript text
  // is sent to the backend, which hands it to the app's own configured LLM
  // (whichever provider is set up — see AITaskExtractor) to pull out clear
  // action items and create them as real meeting to-dos.
  const [recordingModalOpen, setRecordingModalOpen] = useState(false);
  const [isRecordingLocal, setIsRecordingLocal] = useState(false);
  const [isPausedLocal, setIsPausedLocal] = useState(false);
  const [stoppingRecording, setStoppingRecording] = useState(false);
  const [lastRecordingResult, setLastRecordingResult] = useState(null);
  // A short, live, single-line preview so it's obvious in real time whether
  // the mic is actually being picked up — without this, the only feedback
  // was an opaque "No speech was captured" after the fact, with no way to
  // tell mid-recording whether anything was wrong.
  const [listeningPreview, setListeningPreview] = useState("");
  const recognitionRef = useRef(null);
  // Mirror isRecordingLocal/isPausedLocal for use inside the recognition's
  // own event handlers, which close over stale state otherwise.
  const isRecordingRef = useRef(false);
  const isPausedRef = useRef(false);
  const transcriptRef = useRef(""); // accumulated final (non-interim) transcript text for this recording session
  // The last non-routine recognition error (permission denied, no mic,
  // recognition service unreachable, etc.) — surfaced in the "No speech was
  // captured" message so the actual cause isn't a total mystery.
  const lastErrorRef = useRef(null);

  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  const RECOGNITION_ERROR_MESSAGES = {
    "not-allowed": "Microphone access was blocked. Check your browser's site permissions and allow the mic for this page.",
    "service-not-allowed": "Microphone access was blocked. Check your browser's site permissions and allow the mic for this page.",
    "audio-capture": "No microphone was found. Check that one is connected and not in use by another app.",
    "network": "The speech recognition service couldn't be reached. This browser may not support it — try Chrome or Edge with an internet connection.",
  };

  function createRecognition() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcriptRef.current = `${transcriptRef.current} ${event.results[i][0].transcript}`.trim();
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setListeningPreview((interim || transcriptRef.current).slice(-140));
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      lastErrorRef.current = event.error;
      toast.error(RECOGNITION_ERROR_MESSAGES[event.error] || `Transcription error: ${event.error}`);
    };
    // Speech recognition auto-stops after a stretch of silence — if the
    // user still intends to be recording (and hasn't paused), restart it
    // transparently rather than silently losing the rest of the transcript.
    recognition.onend = () => {
      if (isRecordingRef.current && !isPausedRef.current) {
        try { recognition.start(); } catch { /* a start() call is already pending */ }
      }
    };
    return recognition;
  }

  function beginRecording() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      toast.error("Your browser doesn't support live transcription. Try Chrome or Edge.");
      return;
    }
    meetingApi.startRecording(meeting.id).then(onUpdate).catch(() => {}); // best-effort — the "Recording" badge for other participants is a nice-to-have, not a blocker
    lastErrorRef.current = null;
    const recognition = createRecognition();
    recognition.start();
    recognitionRef.current = recognition;
    isRecordingRef.current = true;
    isPausedRef.current = false;
    setIsRecordingLocal(true);
    setIsPausedLocal(false);
    setListeningPreview("");
    setLastRecordingResult(null);
    setRecordingModalOpen(false); // the Start Recording modal's only job was starting it — controls live in the toolbar from here on
  }

  function pauseRecording() {
    isPausedRef.current = true;
    recognitionRef.current?.stop();
    setIsPausedLocal(true);
  }

  function resumeRecording() {
    isPausedRef.current = false;
    const recognition = createRecognition();
    recognition.start();
    recognitionRef.current = recognition;
    setIsPausedLocal(false);
  }

  function resetRecordingState() {
    isRecordingRef.current = false;
    isPausedRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    transcriptRef.current = "";
    setIsRecordingLocal(false);
    setIsPausedLocal(false);
    setListeningPreview("");
  }

  // Discards the recording — no transcript is submitted, no AI extraction
  // runs. Distinct from stopAndSaveRecording below.
  async function cancelRecording() {
    resetRecordingState();
    try {
      onUpdate(await meetingApi.cancelRecording(meeting.id));
    } catch {
      // non-fatal — the "Recording" badge clearing for other participants is best-effort
    }
    toast("Recording cancelled — nothing was saved.");
  }

  async function stopAndSaveRecording() {
    const finalText = transcriptRef.current.trim();
    resetRecordingState();

    if (!finalText) {
      const reason = lastErrorRef.current && RECOGNITION_ERROR_MESSAGES[lastErrorRef.current];
      toast.error(reason || "No speech was captured — check that your microphone is unmuted and permitted for this site.");
      try { await meetingApi.cancelRecording(meeting.id); } catch { /* best-effort badge clear */ }
      return;
    }

    setStoppingRecording(true);
    try {
      const result = await meetingApi.stopRecording(meeting.id, finalText);
      onUpdate(result.meeting);
      setLastRecordingResult(result.tasks_created);
      if (result.tasks_created.length > 0) {
        toast.success(`${result.tasks_created.length} to-do${result.tasks_created.length > 1 ? "s" : ""} created from the transcript.`);
      } else {
        toast("No clear action items were found in the transcript.");
      }
    } catch (err) {
      toast.error(err.message || "Failed to process the recording.");
    } finally {
      setStoppingRecording(false);
    }
  }

  // Meetings are never linked to a team (see meeting.team_id — always
  // null), but Issues and Team News still require one — the toolbar's
  // "Add Issue"/"Add News" default to the first team the user can
  // access, same simplification as the in-section News/IDS create forms.
  useEffect(() => {
    teamApi.list().then(setDefaultTeams).catch(() => setDefaultTeams([]));
  }, []);

  // Spawns the actual floating DOM element/animation — used both for the
  // clicking user's own instant local feedback and for reactions arriving
  // from other participants via the sync poll below. Each <FloatingReaction>
  // removes itself (via removeFloatingReaction, passed as onDone) the
  // instant its own Web-Animations-API animation actually finishes.
  function spawnFloatingReaction(emoji) {
    nextReactionIdRef.current += 1;
    const id = `local-${nextReactionIdRef.current}`;
    const { left, driftX, duration, peakScale, riseVh } = randomReactionOffset();
    setFloatingReactions((prev) => [...prev, { id, emoji, left, driftX, duration, peakScale, riseVh }]);
  }

  function removeFloatingReaction(id) {
    setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
  }

  // Shows/refreshes the small emoji badge pinned to one participant's
  // avatar (see AvatarReactionBadge). Bumping the key even for a repeat
  // emoji from the same user forces a remount, so "if the same user
  // reacts again, show the new emoji again" holds even mid-animation.
  function showAvatarReaction(userId, emoji) {
    if (userId == null) return;
    nextAvatarReactionKeyRef.current += 1;
    setAvatarReactions((prev) => ({ ...prev, [userId]: { key: nextAvatarReactionKeyRef.current, emoji } }));
  }

  function clearAvatarReaction(userId, key) {
    setAvatarReactions((prev) => {
      if (prev[userId]?.key !== key) return prev; // a newer reaction from this user has already replaced it — don't clear that one
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }

  // Clicking a reaction button: play it immediately for the clicker (no
  // waiting on a round-trip), and broadcast it to every other participant
  // currently viewing this meeting via the ephemeral Redis-backed reaction
  // feed (app.core.meeting_reactions) — piggybacked on the same ~2s sync
  // poll below rather than a new push channel, since this app has no
  // WebSocket/SSE infra to plug into. `seenReactionIdsRef` records the
  // server-assigned id once the POST resolves, so the poll doesn't
  // re-animate the sender's own reaction a second time when it reads it
  // back from the feed.
  function fireReaction(emoji) {
    spawnFloatingReaction(emoji);
    showAvatarReaction(user?.id, emoji);
    meetingApi.sendReaction(meeting.id, emoji)
      .then((entry) => { seenReactionIdsRef.current.add(entry.id); lastReactionIdRef.current = Math.max(lastReactionIdRef.current, entry.id); })
      .catch(() => {}); // best-effort broadcast — it already played locally either way
  }

  function openTodoFlow() {
    if (defaultTeams.length === 0) {
      toast.error("No team available to create a to-do under.");
      return;
    }
    if (defaultTeams.length === 1) {
      setTodoModalTeam(defaultTeams[0]);
      setTodoModalOpen(true);
      return;
    }
    setPickedTeamId(String(defaultTeams[0].id));
    setTodoTeamPickerOpen(true);
  }

  function confirmTodoTeam() {
    const team = defaultTeams.find((t) => String(t.id) === pickedTeamId);
    if (!team) return;
    setTodoModalTeam(team);
    setTodoTeamPickerOpen(false);
    setTodoModalOpen(true);
  }

  async function saveTodoFromMeeting(payload) {
    setTodoSaving(true);
    try {
      const created = await taskApi.create(payload);
      setExtraTeamTasks((prev) => [{ ...created, __teamName: todoModalTeam?.name }, ...prev]);
      toast.success("To-Do created.");
      setTodoModalOpen(false);
      setTodoModalTeam(null);
    } catch (err) {
      toast.error(err.message || "Failed to create to-do.");
    } finally {
      setTodoSaving(false);
    }
  }

  async function saveIssueFromMeeting(payload) {
    const { team_id: targetTeamId, ...rest } = payload;
    const teamId = targetTeamId || defaultTeams[0]?.id;
    if (!teamId) {
      toast.error("No team available to file this issue under.");
      return;
    }
    setIssueSaving(true);
    try {
      const created = await issueApi.create(teamId, rest);
      const teamName = defaultTeams.find((t) => t.id === teamId)?.name;
      setExtraIssues((prev) => [{ ...created, __teamName: teamName }, ...prev]);
      toast.success("Issue created.");
      setIssueModalOpen(false);
    } catch (err) {
      toast.error(err.message || "Failed to add issue.");
    } finally {
      setIssueSaving(false);
    }
  }

  async function saveNewsFromMeeting(payload) {
    const { team_id: targetTeamId, ...rest } = payload;
    const teamId = targetTeamId || defaultTeams[0]?.id;
    if (!teamId) {
      toast.error("No team available to post this news item under.");
      return;
    }
    setNewsSaving(true);
    try {
      const created = await teamNewsApi.create(teamId, rest);
      const teamName = defaultTeams.find((t) => t.id === teamId)?.name;
      setExtraNews((prev) => [{ ...created, __teamName: teamName }, ...prev]);
      toast.success("News posted.");
      setNewsModalOpen(false);
    } catch (err) {
      toast.error(err.message || "Failed to post news.");
    } finally {
      setNewsSaving(false);
    }
  }

  // Org-wide member list to add participants from — a meeting isn't
  // team-specific, so this isn't limited to one team's roster.
  useEffect(() => {
    if (!canManage) return;
    userApi.list().then(setOrgUsers).catch(() => {});
  }, [canManage]);

  // Task Assignee bug-fix follow-up: the To-Do modal's Assignee dropdown
  // must be scoped to the PICKED team's eligible members (Client always
  // excluded), never `orgUsers` above (which stays org-wide, unchanged,
  // for adding meeting participants and the Issue/News modals — neither
  // of those is a Task-assignment surface). Loaded via the same
  // team-scoped authorization as the team itself, so this works for a
  // Team Manager picking their own managed team too, with no org-wide
  // Users access required.
  const [todoAssignableUsers, setTodoAssignableUsers] = useState([]);
  useEffect(() => {
    const teamId = todoModalTeam?.id;
    Promise.resolve(teamId ? teamApi.getAssignableUsers(teamId) : [])
      .then((members) => setTodoAssignableUsers(Array.isArray(members) ? members : []))
      .catch(() => setTodoAssignableUsers([]));
  }, [todoModalTeam?.id]);

  // Near-real-time sync: while this panel is open, poll for changes made by
  // anyone else viewing the same meeting (attendance, speaking order, agenda,
  // notes, decisions), so updates don't require a manual page refresh. No
  // websocket/SSE infra exists in this app (the notifications poll in
  // AppLayout.jsx is 15s — deliberately tighter here since "someone just
  // joined" is the whole point of this screen and should show up fast).
  useEffect(() => {
    const id = setInterval(async () => {
      if (checkinSpinningRef.current) return; // don't clobber the shuffle animation mid-spin
      try {
        const fresh = await meetingApi.get(meeting.id);
        onUpdate(fresh);
      } catch {
        // transient poll failure — stay silent, next tick will retry
      }
      try {
        const newReactions = await meetingApi.listReactionsSince(meeting.id, lastReactionIdRef.current);
        for (const entry of newReactions) {
          lastReactionIdRef.current = Math.max(lastReactionIdRef.current, entry.id);
          if (seenReactionIdsRef.current.has(entry.id)) continue; // already animated (this is the sender's own reaction coming back)
          seenReactionIdsRef.current.add(entry.id);
          spawnFloatingReaction(entry.emoji);
          showAvatarReaction(entry.user_id, entry.emoji);
        }
      } catch {
        // transient poll failure — stay silent, next tick will retry
      }
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id]);

  // Auto-join: simply having this panel open counts as being present —
  // don't require a separate explicit "Join Meeting" click on top of that,
  // and never silently leave the current viewer out of the participant/
  // attendee list. Runs once per distinct meeting (the ref guard resets
  // whenever `meeting.id` changes, since this panel can be reused across
  // meetings without unmounting — see MeetingsPage.jsx, which doesn't key
  // it by meeting id).
  const autoJoinAttemptedRef = useRef(null);
  useEffect(() => {
    if (!user?.id || autoJoinAttemptedRef.current === meeting.id) return;
    autoJoinAttemptedRef.current = meeting.id;
    const self = meeting.participants.find((p) => p.user_id === user.id);
    if (!self) {
      joinAsSelf();
    } else if (!self.joined_at) {
      toggleJoined(self);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id, meeting.participants, user?.id]);

  // Timer
  useEffect(() => {
    if (meeting.status !== "ongoing") return;
    const start = meeting.started_at ? new Date(meeting.started_at).getTime() : Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [meeting.status, meeting.started_at]);

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

  // Self-service join for a viewer who wasn't on the original invite list —
  // anyone who can open this meeting (via the org-wide Meetings page, not
  // just people explicitly invited beforehand) should be able to join it,
  // the same way joining a Zoom/Meet link works even if you weren't on the
  // calendar invite. Adds the participant row and marks it joined in one
  // action; previously the only way to appear in the meeting at all was to
  // already be in the invite list, which silently excluded anyone else who
  // showed up, including the host in some cases.
  async function joinAsSelf() {
    if (!user?.id) return;
    try {
      const nextIds = [...meeting.participants.map((p) => p.user_id).filter(Boolean), user.id];
      const updated = await meetingApi.update(meeting.id, { participant_ids: nextIds });
      const joined = await meetingApi.setParticipantJoined(updated.id, user.id, true);
      onUpdate({
        ...updated,
        participants: updated.participants.map((p) => (p.id === joined.id ? joined : p)),
      });
    } catch (err) {
      toast.error(err.message || "Failed to join meeting.");
    }
  }

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

  // Conclude section's "End Meeting" — "Clear meeting items" resets the
  // speaking order/spoken_at flags so next week's meeting starts fresh
  // (the same capability as the "Restart Round" button, just bundled into
  // the end-of-meeting flow); "Send email summary" emails every attendee a
  // recap of this meeting's decisions and action items.
  async function concludeMeeting({ clearMeetingItems, sendEmailSummary }) {
    if (clearMeetingItems) {
      await resetCheckin();
    }
    if (sendEmailSummary) {
      try {
        await meetingApi.sendSummary(meeting.id);
        toast.success("Email summary sending to attendees.");
      } catch (err) {
        toast.error(err.message || "Failed to send email summary.");
      }
    }
    await lifecycle("end");
  }

  async function advanceAgenda() {
    try {
      const updated = await meetingApi.advanceAgenda(meeting.id);
      onUpdate(updated);
    } catch {
      toast.error("Failed to advance agenda.");
    }
  }

  // Clicking an agenda item in the sidebar jumps straight to it — pure
  // navigation, unlike the sequential "Next" button (advanceAgenda above),
  // which also marks the outgoing item done. Anyone can look around; only
  // the host actually moves the shared pointer for everyone else.
  async function selectAgendaItem(itemId) {
    if (!canManage || itemId === meeting.current_agenda_item_id) return;
    try {
      const updated = await meetingApi.selectAgendaItem(meeting.id, itemId);
      onUpdate(updated);
    } catch {
      toast.error("Failed to switch agenda item.");
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

  async function deleteAgendaItem(itemId) {
    try {
      await meetingApi.deleteAgendaItem(meeting.id, itemId);
      onUpdate({ ...meeting, agenda_items: meeting.agenda_items.filter((a) => a.id !== itemId) });
    } catch {
      toast.error("Failed to delete item");
    }
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

  async function submitScore(userId, score, note) {
    try {
      const updated = await meetingApi.setParticipantScore(meeting.id, userId, score, note || null);
      onUpdate({
        ...meeting,
        participants: meeting.participants.map((p) => (p.id === updated.id ? updated : p)),
      });
    } catch (err) {
      toast.error(err.message || "Failed to submit score.");
    }
  }

  const typeLabel = MEETING_TYPES.find((t) => t.value === meeting.meeting_type)?.label || meeting.meeting_type;
  const currentItem = meeting.agenda_items.find((a) => a.id === meeting.current_agenda_item_id);
  const currentInfo = currentItem ? sectionInfoForTitle(currentItem.title) : sectionInfoForTitle(null);
  const joinedParticipants = meeting.participants.filter((p) => p.joined_at);
  const selfParticipant = meeting.participants.find((p) => p.user_id === user?.id);
  const allSpoken = checkinPool.length > 0 && checkinPool.every((p) => p.spoken_at);
  const remainingCandidates = checkinPool.filter(
    (p) => !p.spoken_at && p.id !== meeting.checkin_current_participant_id
  );
  const currentSpeaker = checkinPool.find((p) => p.id === meeting.checkin_current_participant_id);

  return (
    <div className="fixed inset-0 z-50 flex bg-white">
      {/* ── Sidebar ── */}
      <div className={`flex shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] ${sidebarCollapsed ? "w-16" : "w-72"}`}>
        <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-5">
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-slate-900">{meeting.title}</h2>
              <p className="mt-1 text-xs font-semibold text-slate-500">{typeLabel}</p>
              {meeting.is_recording && (
                <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Recording
                </span>
              )}
            </div>
          )}
          <button type="button" onClick={() => setSidebarCollapsed((v) => !v)}
            className="shrink-0 rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50">
            <svg className={`h-3.5 w-3.5 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 010 1.06L9.31 10l3.48 3.71a.75.75 0 11-1.08 1.04l-4-4.25a.75.75 0 010-1.04l4-4.25a.75.75 0 011.08-.02zM7.79 5.23a.75.75 0 010 1.06L4.31 10l3.48 3.71a.75.75 0 11-1.08 1.04l-4-4.25a.75.75 0 010-1.04l4-4.25a.75.75 0 011.08-.02z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="px-4 pb-3">
            {meeting.status === "scheduled" && canManage && (
              <button onClick={() => lifecycle("start")} className="w-full rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">
                Start Meeting
              </button>
            )}
            {meeting.status === "scheduled" && !canManage && (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Waiting for the host to start.</p>
            )}
            {(meeting.status === "ongoing" || meeting.status === "paused") && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-slate-800">{fmtElapsed(elapsed)}</span>
                {canManage && meeting.status === "ongoing" && (
                  <button onClick={() => lifecycle("pause")} className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-700">Pause</button>
                )}
                {canManage && meeting.status === "paused" && (
                  <button onClick={() => lifecycle("resume")} className="ml-auto text-xs font-medium text-blue-700 hover:underline">Resume</button>
                )}
                {canManage && (
                  <button onClick={() => lifecycle("end")} className="text-xs font-medium text-red-600 hover:underline">End</button>
                )}
              </div>
            )}
            {meeting.status === "completed" && (
              <span className="block rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-600">Completed</span>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2">
          {meeting.agenda_items.map((item) => {
            const isCurrent = item.id === meeting.current_agenda_item_id && meeting.status !== "scheduled";
            const info = sectionInfoForTitle(item.title);
            const canNavigate = canManage && meeting.status !== "scheduled" && !isCurrent;
            return (
              <div key={item.id}>
                <div
                  onClick={canNavigate ? () => selectAgendaItem(item.id) : undefined}
                  className={`mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2.5 ${isCurrent ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"} ${canNavigate ? "cursor-pointer" : ""}`}
                  title={canNavigate ? `Jump to ${item.title}` : undefined}
                >
                  <span className={`shrink-0 ${isCurrent ? "text-white" : "text-slate-400"}`}>
                    <AgendaSectionIcon sectionKey={info.key} />
                  </span>
                  {!sidebarCollapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-wide">{item.title}</span>
                      <div className="shrink-0 text-right">
                        {isCurrent ? (
                          <>
                            <p className="text-xs font-bold leading-none">
                              <ItemTimer key={item.id} active={meeting.status === "ongoing"} />
                            </p>
                            <p className={`mt-0.5 text-[10px] leading-none ${isCurrent ? "text-blue-100" : "text-slate-400"}`}>{item.duration_minutes} min</p>
                          </>
                        ) : (
                          <p className="text-xs text-slate-500">{item.duration_minutes} min</p>
                        )}
                      </div>
                      {!isCurrent && info.description && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setPreviewItemId((v) => (v === item.id ? null : item.id)); }}
                          className="shrink-0 text-blue-400 hover:text-blue-600" title="Preview this section">
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                      {canManage && !isCurrent && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); deleteAgendaItem(item.id); }}
                          className="shrink-0 text-slate-300 hover:text-red-500" title="Delete this section">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zm-1 7a1 1 0 012 0v4a1 1 0 11-2 0V9zm4 0a1 1 0 012 0v4a1 1 0 11-2 0V9z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!sidebarCollapsed && previewItemId === item.id && info.description && (
                  <p className="mb-2 px-3 pb-1 text-xs text-slate-500">{info.description}</p>
                )}
              </div>
            );
          })}
          {!sidebarCollapsed && canManage && (
            <div className="mt-1 flex items-center gap-1 px-1">
              <input
                value={newAgendaTitle}
                onChange={(e) => setNewAgendaTitle(e.target.value)}
                placeholder="+ Add section…"
                onKeyDown={(e) => e.key === "Enter" && addAgendaItem()}
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-xs text-slate-600 placeholder:text-slate-400 hover:border-slate-200 focus:border-slate-300 focus:outline-none"
              />
              {newAgendaTitle.trim() && (
                <button type="button" onClick={addAgendaItem} className="shrink-0 rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800">
                  Add
                </button>
              )}
            </div>
          )}
        </div>

        {!sidebarCollapsed && canManage && meeting.status === "ongoing" && (
          <div className="border-t border-slate-100 p-3">
            <button onClick={advanceAgenda} className="w-full rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">
              Next
            </button>
          </div>
        )}

        <button onClick={onClose} className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-3.5 text-sm font-medium text-blue-700 hover:bg-slate-50">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          {!sidebarCollapsed && "Leave Meeting"}
        </button>
      </div>

      {/* ── Main ── */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Reactions land here — a full-bleed overlay pinned to this
            content pane (not the bottom toolbar), so a reaction has the
            entire content height to rise through, not just a sliver near
            the buttons. This pane (the parent `relative` wrapper above)
            spans the full available height, so `inset-0` here really does
            give each reaction the whole pane to travel across. Each
            FloatingReaction drives its own rise/drift/fade directly via
            the Web Animations API — see the component for why (a plain
            CSS class + custom-property combination here compiled fine but
            never visibly animated in the browser). pointer-events-none +
            overflow-hidden: reactions never block clicks, never cause a
            scrollbar, and are purely visual — no page layout depends on
            this div's size. z-30 keeps them above the toolbar/popovers in
            this pane. */}
        <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
          {floatingReactions.map((r) => (
            <FloatingReaction key={r.id} {...r} onDone={() => removeFloatingReaction(r.id)} />
          ))}
        </div>

        {meeting.status === "ongoing" && canManage && (
          <div className="flex items-center justify-end gap-2 border-b border-slate-100 px-6 py-3">
            <div className="relative">
              <button type="button" onClick={openTodoFlow}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                Add To-Do
              </button>
              {todoTeamPickerOpen && (
                <div className="absolute right-0 top-9 z-20 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                  <p className="mb-2 text-xs font-semibold text-slate-500">Which team is this to-do for?</p>
                  <Select value={pickedTeamId} onChange={(e) => setPickedTeamId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm text-slate-700">
                    {defaultTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setTodoTeamPickerOpen(false)}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                    <button type="button" onClick={confirmTodoTeam}
                      className="flex-1 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700">Continue</button>
                  </div>
                </div>
              )}
            </div>
            <button type="button" onClick={() => (defaultTeams.length ? setIssueModalOpen(true) : toast.error("No team available to file this issue under."))}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
              Add Issue
            </button>
            <button type="button" onClick={() => (defaultTeams.length ? setNewsModalOpen(true) : toast.error("No team available to post this news item under."))}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M3.5 3.75A.75.75 0 014.25 3h10.5a.75.75 0 01.6 1.2l-3 4a.75.75 0 000 .9l3 4a.75.75 0 01-.6 1.2H5.5v3.25a.75.75 0 01-1.5 0V3.75z" /></svg>
              Add News
            </button>
            {!isRecordingLocal ? (
              <button type="button" onClick={() => setRecordingModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7 4a3 3 0 116 0v6a3 3 0 11-6 0V4z" />
                  <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
                </svg>
                Record Transcription
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5">
                <span className="flex items-center gap-1.5 px-1 text-xs font-semibold text-red-600">
                  <span className={`h-1.5 w-1.5 rounded-full bg-red-500 ${isPausedLocal ? "" : "animate-pulse"}`} />
                  {isPausedLocal ? "Paused" : "Recording"}
                </span>
                {isPausedLocal ? (
                  <button type="button" onClick={resumeRecording} disabled={stoppingRecording}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                    Resume
                  </button>
                ) : (
                  <button type="button" onClick={pauseRecording} disabled={stoppingRecording}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                    Pause Recording
                  </button>
                )}
                <button type="button" onClick={stopAndSaveRecording} disabled={stoppingRecording}
                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {stoppingRecording ? "Processing…" : "Stop & Save"}
                </button>
                <button type="button" onClick={cancelRecording} disabled={stoppingRecording}
                  className="rounded-md px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50">
                  Cancel Recording
                </button>
              </div>
            )}
          </div>
        )}

        {isRecordingLocal && !isPausedLocal && (
          <div className="border-b border-slate-100 bg-slate-50 px-6 py-1.5 text-right text-xs text-slate-500">
            {listeningPreview ? <span className="italic">"…{listeningPreview}"</span> : "Listening… (say something to confirm the mic is working)"}
          </div>
        )}

        {recordingModalOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-8 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <h2 className="text-base font-bold text-slate-900">Record Transcription</h2>
                <button type="button" onClick={() => setRecordingModalOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4 p-6">
                <button type="button" onClick={beginRecording}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600">
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M6 4l10 6-10 6V4z" /></svg>
                  Start Recording
                </button>

                <p className="text-xs text-slate-500">
                  Speech is transcribed live in your browser as the meeting happens — no audio is ever uploaded or stored.
                  {" "}Once started, you can pause, resume, cancel, or stop &amp; save from the toolbar. Stopping and saving
                  {" "}analyzes the transcript and adds any clear action items to this meeting's To-Do list automatically.
                </p>

                {lastRecordingResult && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                    {lastRecordingResult.length > 0 ? (
                      <>
                        <p className="font-semibold">Created {lastRecordingResult.length} to-do{lastRecordingResult.length > 1 ? "s" : ""}:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {lastRecordingResult.map((t, i) => (
                            <li key={i}>{t.title}{t.assignee_name ? ` — ${t.assignee_name}` : ""}{t.due_date ? ` (due ${t.due_date})` : ""}</li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      "No clear action items were found in the transcript."
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="font-semibold">Important</p>
                  <p className="mt-1">Works best in Chrome or Edge, with your microphone unmuted. Keep this tab open while recording.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {todoModalOpen && todoModalTeam && (
          <CreateTodoModal
            team={todoModalTeam}
            users={todoAssignableUsers}
            onClose={() => { setTodoModalOpen(false); setTodoModalTeam(null); }}
            onSave={saveTodoFromMeeting}
            saving={todoSaving}
          />
        )}
        {issueModalOpen && (
          <IssueModal
            team={defaultTeams[0]}
            teams={defaultTeams}
            users={orgUsers}
            projects={[]}
            onClose={() => setIssueModalOpen(false)}
            onSave={saveIssueFromMeeting}
            saving={issueSaving}
          />
        )}
        {newsModalOpen && (
          <NewsModal
            team={defaultTeams[0]}
            teams={defaultTeams}
            users={orgUsers}
            currentUser={user}
            onClose={() => setNewsModalOpen(false)}
            onSave={saveNewsFromMeeting}
            saving={newsSaving}
          />
        )}

        {/* ── Live view: waiting room (scheduled) or agenda runner (ongoing/paused) ── */}
        {meeting.status === "scheduled" ? (
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <h1 className="text-xl font-bold text-slate-800">Waiting for Attendees to Join</h1>
            <div className="mt-6 flex flex-wrap gap-x-10 gap-y-6">
              {/* You aren't on the invite list yet — join anyway. Being
                  able to open this meeting at all (e.g. from the org-wide
                  Meetings page) shouldn't require having been formally
                  invited beforehand to actually take part in it. */}
              {!selfParticipant && (
                <div className="flex items-center gap-3">
                  <Avatar name={user?.full_name || user?.email} size="h-11 w-11" />
                  <div>
                    <p className="text-base font-semibold text-slate-500">{user?.full_name || user?.email}</p>
                    <button type="button" onClick={joinAsSelf}
                      className="mt-0.5 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                      Join Meeting
                    </button>
                  </div>
                </div>
              )}
              {meeting.participants.length === 0 ? (
                <p className="text-sm text-slate-400">No other attendees invited yet.</p>
              ) : (
                // Every invited attendee is shown, not just who's already
                // joined — self gets a Join/Leave button, and the host can
                // toggle anyone else present/absent (same toggleJoined()
                // used everywhere else attendance is taken).
                meeting.participants.map((p) => {
                  const isSelf = p.user_id === user?.id;
                  const joined = Boolean(p.joined_at);
                  const name = p.user?.full_name || p.user?.email;
                  return (
                    <div key={p.id} className={`flex items-center gap-3 ${joined ? "" : "opacity-50"}`}>
                      <Avatar name={name} size="h-11 w-11" />
                      <div>
                        <p className={`text-base font-semibold ${joined ? "text-slate-900" : "text-slate-500"}`}>{name}</p>
                        {isSelf ? (
                          <button type="button" onClick={() => toggleJoined(p)}
                            className="mt-0.5 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                            {joined ? "Leave Meeting" : "Join Meeting"}
                          </button>
                        ) : canManage ? (
                          <div className="mt-1 flex items-center gap-2">
                            <button type="button" onClick={() => toggleJoined(p)}
                              className="flex items-center gap-2 text-xs font-medium text-slate-500">
                              <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${joined ? "bg-emerald-500" : "bg-slate-300"}`}>
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${joined ? "translate-x-4" : "translate-x-0.5"}`} />
                              </span>
                              {joined ? "Present" : "Absent"}
                            </button>
                            <button type="button" onClick={() => removeParticipant(p)} className="text-xs font-medium text-slate-400 hover:text-red-500">
                              Remove
                            </button>
                          </div>
                        ) : (
                          <p className="mt-0.5 text-xs text-slate-400">{joined ? "Present" : "Absent"}</p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {canManage && (
              <div className="mt-6 flex max-w-sm items-center gap-2">
                <Select value={addParticipantId} onChange={(e) => setAddParticipantId(e.target.value)} className="flex-1 px-3 py-2 text-sm">
                  <option value="">{availableToAdd.length === 0 ? "No more org members to add" : "Add an attendee…"}</option>
                  {availableToAdd.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                </Select>
                <button type="button" onClick={addParticipant} disabled={!addParticipantId || addingParticipant}
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                  {addingParticipant ? "Adding…" : "+ Add"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center overflow-y-auto px-8 py-8 text-center">
            {currentItem ? (
              <>
                <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-800">
                  <AgendaSectionIcon sectionKey={currentInfo.key} className="h-4 w-4 text-slate-500" />
                  {currentItem.title}
                  {currentInfo.description && <span className="ml-1 font-normal normal-case text-slate-400">· {currentInfo.description}</span>}
                </div>

                {currentInfo.key === "scorecard" ? (
                  <div className="mt-8 flex w-full flex-1 justify-center"><KpiSection /></div>
                ) : currentInfo.key === "rock_review" ? (
                  <div className="mt-8 flex w-full flex-1 justify-center"><RockReviewSection canManage={canManage} /></div>
                ) : currentInfo.key === "news" ? (
                  <div className="mt-8 flex w-full flex-1 justify-center"><NewsSection canManage={canManage} extraItems={extraNews} /></div>
                ) : currentInfo.key === "todo_list" ? (
                  <div className="mt-8 flex w-full flex-1 justify-center">
                    <TodoListSection meeting={meeting} canManage={canManage} taskName={taskName} setTaskName={setTaskName} onCreateTask={createTask} extraTeamTasks={extraTeamTasks} />
                  </div>
                ) : currentInfo.key === "ids" ? (
                  <div className="mt-8 flex w-full flex-1 justify-center"><IdsSection canManage={canManage} extraItems={extraIssues} /></div>
                ) : currentInfo.key === "conclude" ? (
                  <div className="mt-8 flex w-full flex-1 justify-center">
                    <ConcludeSection
                      meeting={meeting} canManage={canManage} selfParticipant={selfParticipant}
                      taskName={taskName} setTaskName={setTaskName} onCreateTask={createTask}
                      decisionContent={decisionContent} setDecisionContent={setDecisionContent}
                      onAddDecision={addDecision} onDeleteDecision={deleteDecision}
                      onSubmitRating={(score) => submitScore(user.id, score)}
                      onEndMeeting={concludeMeeting}
                    />
                  </div>
                ) : checkinPool.length > 0 ? (
                  <>
                    {/* One row, one box per joined attendee — bordered/highlighted
                        for whoever's current. (Previously this also drew a
                        separate large avatar for the current speaker above this
                        same row, showing that one person twice.) */}
                    <div className="mt-10 flex flex-wrap justify-center gap-3">
                      {checkinPool.map((p) => {
                        const isCurrent = p.id === meeting.checkin_current_participant_id;
                        const isFlashing = checkinSpinning && p.id === checkinFlashId;
                        const state = isCurrent ? "current" : isFlashing ? "flashing" : p.spoken_at ? (p.skipped ? "skipped" : "done") : "waiting";
                        return (
                          <SpeakingOrderAvatar key={p.id} name={p.user?.full_name || p.user?.email} state={state}
                            onClick={() => isCurrent && !checkinSpinning && advanceCheckin()} />
                        );
                      })}
                    </div>
                    {!currentSpeaker && (
                      <p className="mt-3 text-sm text-slate-400">{allSpoken ? "Round complete" : "No one selected yet"}</p>
                    )}

                    <div className="mt-6 flex items-center gap-2">
                      {!allSpoken && (
                        <button type="button" onClick={advanceCheckin} disabled={checkinSpinning}
                          className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
                          {checkinSpinning ? "Picking…" : "Auto Pick Next"}
                        </button>
                      )}
                      {currentSpeaker && !checkinSpinning && (
                        <button type="button" onClick={skipCheckin}
                          className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                          Skip
                        </button>
                      )}
                      {remainingCandidates.length > 0 && (
                        <Select value={manualSpeakerId} onChange={(e) => setManualSpeakerId(e.target.value)}
                          className="px-3 py-2.5 text-xs">
                          <option value="">Pick manually…</option>
                          {remainingCandidates.map((p) => (
                            <option key={p.id} value={p.user_id}>{p.user?.full_name || p.user?.email}</option>
                          ))}
                        </Select>
                      )}
                      {manualSpeakerId && (
                        <button type="button" onClick={selectSpeaker} className="text-xs font-semibold text-blue-700 hover:underline">Set</button>
                      )}
                    </div>
                    {(meeting.checkin_current_participant_id || checkinPool.some((p) => p.spoken_at)) && !checkinSpinning && (
                      <button type="button" onClick={resetCheckin} className="mt-3 text-xs font-medium text-slate-400 hover:text-slate-600">
                        Restart Round
                      </button>
                    )}
                  </>
                ) : (
                  <p className="mt-10 text-sm text-slate-400">No joined attendees yet — reactions and speaking order will appear here once people join.</p>
                )}
              </>
            ) : (
              <p className="mt-10 text-sm text-slate-400">All agenda items complete.</p>
            )}
          </div>
        )}

        {meeting.status !== "scheduled" && (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Joined</p>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  {joinedParticipants.length === 0 ? (
                    <span className="text-xs text-slate-300">No one yet</span>
                  ) : (
                    joinedParticipants.map((p) => (
                      <span key={p.id} className="relative rounded-full ring-2 ring-white" title={p.user?.full_name || p.user?.email}>
                        <Avatar name={p.user?.full_name || p.user?.email} size="h-7 w-7" />
                        {p.user_id != null && avatarReactions[p.user_id] && (
                          <AvatarReactionBadge
                            key={avatarReactions[p.user_id].key}
                            emoji={avatarReactions[p.user_id].emoji}
                            onDone={() => clearAvatarReaction(p.user_id, avatarReactions[p.user_id].key)}
                          />
                        )}
                      </span>
                    ))
                  )}
                </div>
                {/* You're viewing a meeting already in progress and aren't
                    on the participant list yet — same self-join affordance
                    as the pre-start waiting room. */}
                {!selfParticipant && (
                  <button type="button" onClick={joinAsSelf}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    Join
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {REACTION_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => fireReaction(emoji)}
                  className="rounded-lg p-1.5 text-lg transition-transform hover:scale-110 hover:bg-slate-50">
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
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
