import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import { meetingApi } from "../api/meetingApi";
import { teamApi } from "../api/teamApi";
import { userApi } from "../api/userApi";
import { taskApi } from "../api/taskApi";
import { issueApi } from "../api/issueApi";
import { teamNewsApi } from "../api/teamNewsApi";
import { rockApi } from "../api/rockApi";
import { kpiApi } from "../api/kpiApi";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import Select from "../components/Select";
import CreateMeetingModal from "../components/meetings/CreateMeetingModal";
import { AgendaSectionIcon } from "../components/meetings/meetingHelpers";
import { MEETING_TYPES, fmtDateTime } from "../components/meetings/meetingConstants";
import { KpiSection, RockReviewSection, NewsSection, TodoListSection, IdsSection } from "../components/meetings/liveSections";
import { CreateTodoModal, NewsModal } from "./TeamDetailPage";
import { IssueModal } from "./IssuesTab";
import { RockModal } from "./RocksTab";
import { KPIModal } from "./KPIsTab";
import { LiveMeetingPanel } from "./MeetingsTab";

/**
 * Standing "meeting hub" page for one meeting — Overview (every EOS
 * section visible at once as stacked cards, not one-at-a-time like the
 * live agenda runner) + Meeting History, reached by clicking a meeting's
 * name anywhere in MeetingsPage.jsx. "Join" opens the exact same
 * LiveMeetingPanel used elsewhere as a full-screen overlay on top of this
 * page — this page itself is the always-available reference view, the
 * live panel is the in-session experience.
 */

function ChevronIcon({ open, className = "h-4 w-4" }) {
  return (
    <svg className={`${className} shrink-0 transition-transform ${open ? "" : "-rotate-180"}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}

function fmtScheduleLine(meeting) {
  const d = new Date(meeting.scheduled_at);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined }).toLowerCase().replace(" ", "");
  if (meeting.recurrence === "weekly") return `${weekday}s at ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${time}`;
}

// A distinct accent per section — turns five identical white cards into a
// scannable page (each icon badge tinted, matching its section) instead of
// relying on text alone to tell KPI apart from IDS at a glance.
const SECTION_ACCENTS = {
  scorecard: { icon: "bg-sky-100 text-sky-600", ring: "hover:ring-sky-100" },
  rock_review: { icon: "bg-amber-100 text-amber-600", ring: "hover:ring-amber-100" },
  news: { icon: "bg-violet-100 text-violet-600", ring: "hover:ring-violet-100" },
  todo_list: { icon: "bg-emerald-100 text-emerald-600", ring: "hover:ring-emerald-100" },
  ids: { icon: "bg-rose-100 text-rose-600", ring: "hover:ring-rose-100" },
};

// The card chrome every Overview section shares — icon badge, title, short
// description, an optional "+ Add" action, and a collapse toggle. The
// section content itself (KPI/Rock Review/News/To-Do/IDS) is exactly the
// same, already-working component the live agenda runner uses — this page
// just shows all of them at once, dressed up as its own card, instead of
// one at a time.
function SectionCard({ sectionKey, title, description, onAdd, addLabel, children }) {
  const [open, setOpen] = useState(true);
  const accent = SECTION_ACCENTS[sectionKey] || SECTION_ACCENTS.scorecard;
  return (
    <div className={`mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-transparent transition-shadow hover:shadow-md ${accent.ring}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${accent.icon}`}>
            <AgendaSectionIcon sectionKey={sectionKey} className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-800">{title}</h2>
            <span className="hidden truncate text-xs text-slate-400 sm:block">{description}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {onAdd && (
            <button type="button" onClick={onAdd}
              className="flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-800">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" /></svg>
              {addLabel || "Add"}
            </button>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <ChevronIcon open={open} />
          </button>
        </div>
      </div>
      {open && <div className="w-full bg-slate-50/60 p-5">{children}</div>}
    </div>
  );
}

const OVERVIEW_SECTIONS = [
  { key: "scorecard", title: "KPI", description: 'Report "on-track" or "off-track" on your most important numbers.', addLabel: "Add Measurable" },
  { key: "rock_review", title: "Rock Review", description: "Are your 90-day goals on track to be done by the end of the quarter?", addLabel: "Add Rock" },
  // Titled "News" (not "Headlines") — an earlier request explicitly
  // renamed this section everywhere in the meeting system.
  { key: "news", title: "News", description: "FYIs for the team. Share short and sweet updates about team members and customers.", addLabel: "Add News" },
  { key: "todo_list", title: "To-Do List", description: 'Review To-Dos from last week’s meeting with a quick "Done" or "Not Done" response.', addLabel: "Add To-Do" },
  { key: "ids", title: "IDS", description: "Problems and obstacles to discuss with the team in IDS.", addLabel: "Add Issue" },
];

function OverviewTab({ meeting, canManage, onCreateTask, taskName, setTaskName, onAdd, extras }) {
  return (
    <div>
      {OVERVIEW_SECTIONS.map((section) => (
        <SectionCard
          key={section.key}
          sectionKey={section.key}
          title={section.title}
          description={section.description}
          addLabel={section.addLabel}
          onAdd={canManage ? () => onAdd(section.key) : null}
        >
          {section.key === "scorecard" ? (
            <KpiSection extraItems={extras.kpis} wide />
          ) : section.key === "rock_review" ? (
            <RockReviewSection canManage={canManage} extraItems={extras.rocks} wide />
          ) : section.key === "news" ? (
            <NewsSection canManage={canManage} extraItems={extras.news} wide />
          ) : section.key === "todo_list" ? (
            <TodoListSection meeting={meeting} canManage={canManage} taskName={taskName} setTaskName={setTaskName} onCreateTask={onCreateTask} extraTeamTasks={extras.tasks} wide />
          ) : (
            <IdsSection canManage={canManage} extraItems={extras.issues} wide />
          )}
        </SectionCard>
      ))}
    </div>
  );
}

function avgRating(participants) {
  const scored = (participants || []).filter((p) => p.score != null);
  if (scored.length === 0) return null;
  return scored.reduce((sum, p) => sum + p.score, 0) / scored.length;
}

function runDurationMinutes(meeting) {
  if (!meeting.started_at) return null;
  const end = meeting.ended_at ? new Date(meeting.ended_at) : new Date();
  return Math.max(1, Math.round((end - new Date(meeting.started_at)) / 60000));
}

// There's no separate "meeting series with N past instances" concept in
// this app's data model (each Meeting row is one instance; a duplicate
// title is actively rejected at creation — see check_meeting_title) — so
// unlike a product that logs every weekly run as its own history row, this
// shows the ONE real run this meeting row has actually had, if any.
function MeetingHistoryTab({ meeting }) {
  const typeLabel = MEETING_TYPES.find((t) => t.value === meeting.meeting_type)?.label || meeting.meeting_type;
  const duration = runDurationMinutes(meeting);
  const rating = avgRating(meeting.participants);

  return (
    <div>
      <h2 className="mb-3 text-lg font-bold text-slate-900">Meeting History</h2>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!meeting.started_at ? (
          <p className="p-10 text-center text-sm text-slate-400">This meeting hasn't been started yet — its run history will appear here once it has.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Meeting Name</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Duration</th>
                  <th className="px-4 py-2.5">Rating Average</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{fmtDateTime(meeting.started_at)}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-blue-700">{meeting.title}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white">{typeLabel}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{duration != null ? `${duration} min` : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{rating != null ? rating.toFixed(1) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MeetingDetailPage() {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm } = useConfirm();

  const canManage = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin
    || user?.role === "team_manager" || user?.is_team_manager
    || user?.role === "project_manager" || user?.is_project_manager;

  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [teams, setTeams] = useState([]);
  const [orgUsers, setOrgUsers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [taskName, setTaskName] = useState("");

  // ── "+ Add" per section — each reuses the exact real modal its own
  // dedicated page uses (RockModal/KPIModal/IssueModal/NewsModal), same
  // "use the existing modal components" approach as the live meeting
  // toolbar. To-Do is the one case needing a team-pick step first: unlike
  // the others, CreateTodoModal has no internal team picker.
  const [openModal, setOpenModal] = useState(null); // "kpi" | "rock" | "news" | "issue" | "todo" | null
  const [todoTeamPickerOpen, setTodoTeamPickerOpen] = useState(false);
  const [pickedTeamId, setPickedTeamId] = useState("");
  const [todoModalTeam, setTodoModalTeam] = useState(null);
  const [saving, setSaving] = useState(false);
  // Freshly-created items, kept here and passed down so each section shows
  // the new item immediately without a page refresh.
  const [extraKpis, setExtraKpis] = useState([]);
  const [extraRocks, setExtraRocks] = useState([]);
  const [extraNews, setExtraNews] = useState([]);
  const [extraIssues, setExtraIssues] = useState([]);
  const [extraTasks, setExtraTasks] = useState([]);

  useEffect(() => {
    teamApi.list().then(setTeams).catch(() => setTeams([]));
    userApi.list().then(setOrgUsers).catch(() => setOrgUsers([]));
  }, []);

  useEffect(() => {
    meetingApi.get(meetingId)
      .then((m) => { setMeeting(m); setLoading(false); })
      .catch(() => {
        toast.error("That meeting is no longer available.");
        navigate("/meetings", { replace: true });
      });
  }, [meetingId, navigate]);

  // Quiet background refresh — same idea as MeetingsPage's own status poll:
  // keeps the attendee count / To-Do list / recording badge current for
  // anyone with this page open without a manual reload, without touching
  // the loading-skeleton state.
  useEffect(() => {
    const id = setInterval(() => {
      meetingApi.get(meetingId).then(setMeeting).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [meetingId]);

  async function createTask() {
    if (!taskName.trim() || !meeting) return;
    try {
      const mt = await meetingApi.createTask(meeting.id, { name: taskName.trim() });
      setMeeting((prev) => ({ ...prev, meeting_tasks: [...prev.meeting_tasks, mt] }));
      setTaskName("");
      toast.success("Task created");
    } catch {
      toast.error("Failed to create task");
    }
  }

  function openAdd(sectionKey) {
    if (teams.length === 0) {
      toast.error("No team available to add this under.");
      return;
    }
    if (sectionKey === "todo_list") {
      if (teams.length === 1) {
        setTodoModalTeam(teams[0]);
        setOpenModal("todo");
        return;
      }
      setPickedTeamId(String(teams[0].id));
      setTodoTeamPickerOpen(true);
      return;
    }
    setOpenModal({ scorecard: "kpi", rock_review: "rock", news: "news", ids: "issue" }[sectionKey]);
  }

  function confirmTodoTeam() {
    const team = teams.find((t) => String(t.id) === pickedTeamId);
    if (!team) return;
    setTodoModalTeam(team);
    setTodoTeamPickerOpen(false);
    setOpenModal("todo");
  }

  async function saveKpi(payload) {
    const { team_id: targetTeamId, ...rest } = payload;
    const teamId = targetTeamId || teams[0]?.id;
    setSaving(true);
    try {
      const created = await kpiApi.create(teamId, rest);
      setExtraKpis((prev) => [{ ...created, __teamName: teams.find((t) => t.id === teamId)?.name }, ...prev]);
      toast.success("Measurable added.");
      setOpenModal(null);
    } catch (err) {
      toast.error(err.message || "Failed to add measurable.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRock(payload) {
    const { team_id: targetTeamId, ...rest } = payload;
    const teamId = targetTeamId || teams[0]?.id;
    setSaving(true);
    try {
      const created = await rockApi.create(teamId, rest);
      setExtraRocks((prev) => [{ ...created, __teamName: teams.find((t) => t.id === teamId)?.name }, ...prev]);
      toast.success("Rock added.");
      setOpenModal(null);
    } catch (err) {
      toast.error(err.message || "Failed to add rock.");
    } finally {
      setSaving(false);
    }
  }

  async function saveNews(payload) {
    const { team_id: targetTeamId, ...rest } = payload;
    const teamId = targetTeamId || teams[0]?.id;
    setSaving(true);
    try {
      const created = await teamNewsApi.create(teamId, rest);
      setExtraNews((prev) => [{ ...created, __teamName: teams.find((t) => t.id === teamId)?.name }, ...prev]);
      toast.success("News posted.");
      setOpenModal(null);
    } catch (err) {
      toast.error(err.message || "Failed to post news.");
    } finally {
      setSaving(false);
    }
  }

  async function saveIssue(payload) {
    const { team_id: targetTeamId, ...rest } = payload;
    const teamId = targetTeamId || teams[0]?.id;
    setSaving(true);
    try {
      const created = await issueApi.create(teamId, rest);
      setExtraIssues((prev) => [{ ...created, __teamName: teams.find((t) => t.id === teamId)?.name }, ...prev]);
      toast.success("Issue added.");
      setOpenModal(null);
    } catch (err) {
      toast.error(err.message || "Failed to add issue.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTodo(payload) {
    setSaving(true);
    try {
      const created = await taskApi.create(payload);
      setExtraTasks((prev) => [{ ...created, __teamName: todoModalTeam?.name }, ...prev]);
      toast.success("To-Do created.");
      setOpenModal(null);
      setTodoModalTeam(null);
    } catch (err) {
      toast.error(err.message || "Failed to create to-do.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEditSave(payload) {
    const updated = await meetingApi.update(meeting.id, payload);
    setMeeting((prev) => ({ ...prev, ...updated }));
    setEditing(false);
    toast.success("Meeting updated.");
  }

  async function handleDelete() {
    if (!(await confirm({ message: `Delete "${meeting.title}"? This can't be undone.`, tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await meetingApi.delete(meeting.id);
      toast.success("Meeting deleted.");
      navigate("/meetings", { replace: true });
    } catch (err) {
      toast.error(err.message || "Unable to delete meeting.");
    }
  }

  if (loading || !meeting) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="h-6 w-64 animate-pulse rounded bg-slate-100" />
        <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <nav className="mb-3 flex items-center gap-1.5 text-sm text-slate-400">
        <Link to="/meetings" className="text-blue-700 hover:underline">Meetings</Link>
        <span>›</span>
        <span className="truncate text-slate-500">{meeting.title}</span>
      </nav>

      <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 via-white to-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-extrabold uppercase tracking-tight text-slate-900">{meeting.title}</h1>
              {canManage && (
                <div className="relative">
                  <button type="button" onClick={() => setMenuOpen((v) => !v)} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-600">
                    <ChevronIcon open={menuOpen} />
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                      <div className="absolute left-0 top-8 z-20 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                        <button type="button" onClick={() => { setMenuOpen(false); handleDelete(); }} className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                          Delete meeting
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {canManage && (
                <button type="button" onClick={() => setEditing(true)} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-600" title="Edit meeting">
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.5 8.5a2 2 0 01-.878.507l-3 .857a.5.5 0 01-.618-.618l.857-3a2 2 0 01.507-.878l8.5-8.5z" />
                  </svg>
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM1 20c0-3.314 2.686-6 6-6s6 2.686 6 6M11 20c0-2.21.895-4.21 2.343-5.657A5.978 5.978 0 0117 13c3.314 0 6 2.686 6 6" />
                </svg>
                {meeting.participants.length} Attendee{meeting.participants.length === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 shadow-sm">
                {MEETING_TYPES.find((t) => t.value === meeting.meeting_type)?.label || meeting.meeting_type}
              </span>
              {meeting.is_recording && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 shadow-sm">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Recording
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="text-sm font-semibold text-slate-700">{fmtScheduleLine(meeting)}</span>
            <button type="button" onClick={() => setLiveOpen(true)}
              className="rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-800">
              Join
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {[{ id: "overview", label: "Overview" }, { id: "history", label: "Meeting History" }].map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab
          meeting={meeting} canManage={canManage} onCreateTask={createTask} taskName={taskName} setTaskName={setTaskName}
          onAdd={openAdd}
          extras={{ kpis: extraKpis, rocks: extraRocks, news: extraNews, issues: extraIssues, tasks: extraTasks }}
        />
      ) : (
        <MeetingHistoryTab meeting={meeting} />
      )}

      {editing && (
        <CreateMeetingModal
          teams={teams}
          teamMembers={[]}
          meeting={meeting}
          onSave={handleEditSave}
          onClose={() => setEditing(false)}
        />
      )}

      {liveOpen && (
        <LiveMeetingPanel
          meeting={meeting}
          canManage={canManage}
          onUpdate={setMeeting}
          onClose={() => setLiveOpen(false)}
        />
      )}

      {todoTeamPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="mb-1 text-base font-bold text-slate-900">Which team is this to-do for?</h3>
            <p className="mb-3 text-xs text-slate-500">To-Dos belong to a team — pick which one this belongs under.</p>
            <Select value={pickedTeamId} onChange={(e) => setPickedTeamId(e.target.value)} className="w-full px-3 py-2 text-sm text-slate-700">
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setTodoTeamPickerOpen(false)}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={confirmTodoTeam}
                className="flex-1 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800">Continue</button>
            </div>
          </div>
        </div>
      )}

      {openModal === "kpi" && (
        <KPIModal team={teams[0]} teams={teams} users={orgUsers} rocks={[]} groups={[]} projects={[]}
          currentUser={user} onClose={() => setOpenModal(null)} onSave={saveKpi} saving={saving} onGroupCreated={() => {}} />
      )}
      {openModal === "rock" && (
        <RockModal team={teams[0]} teams={teams} users={orgUsers} objectives={[]} projects={[]}
          currentUser={user} onClose={() => setOpenModal(null)} onSave={saveRock} saving={saving} />
      )}
      {openModal === "news" && (
        <NewsModal team={teams[0]} teams={teams} users={orgUsers} currentUser={user}
          onClose={() => setOpenModal(null)} onSave={saveNews} saving={saving} />
      )}
      {openModal === "issue" && (
        <IssueModal team={teams[0]} teams={teams} users={orgUsers} projects={[]}
          onClose={() => setOpenModal(null)} onSave={saveIssue} saving={saving} />
      )}
      {openModal === "todo" && todoModalTeam && (
        <CreateTodoModal team={todoModalTeam} users={orgUsers}
          onClose={() => { setOpenModal(null); setTodoModalTeam(null); }} onSave={saveTodo} saving={saving} />
      )}
    </div>
  );
}
