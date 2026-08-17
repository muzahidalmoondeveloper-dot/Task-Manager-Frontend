import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { kpiApi } from "../../api/kpiApi";
import { rockApi } from "../../api/rockApi";
import { teamNewsApi } from "../../api/teamNewsApi";
import { issueApi } from "../../api/issueApi";
import { teamApi } from "../../api/teamApi";

// ─── Shared bits ────────────────────────────────────────────────────────────

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}
    </div>
  );
}

// Meetings aren't tied to any one team (see meeting.team_id — always null
// for meetings created through this app), but Rocks, KPIs, Issues, and
// Team News all live under a specific team. Rather than ask the meeting's
// attendees to pick a team before they can see anything, every section
// below aggregates across every team the current user can already see
// (teamApi.list() is itself access-scoped) and shows it all by default —
// no picker. Each row still carries its own `team_id` from the API
// response, so per-row actions (change a rock's status, resolve an issue,
// archive a news item) target the right team without needing one
// "selected" globally.
function useTeams() {
  const [teams, setTeams] = useState(null);
  useEffect(() => {
    teamApi.list().then(setTeams).catch(() => setTeams([]));
  }, []);
  return teams;
}

// Fetches `listFn(team.id)` for every accessible team in parallel and
// flattens the results, tagging each item with the team it came from.
// `listFn` must be a stable reference (e.g. `kpiApi.list`, not an inline
// arrow) since it's a dependency of the effect below.
function useAggregated(teams, listFn) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!teams) return;
    Promise.all(
      teams.map((t) =>
        listFn(t.id)
          .then((list) => list.map((item) => ({ ...item, __teamName: t.name })))
          .catch(() => [])
      )
    ).then((results) => setItems(results.flat()));
  }, [teams, listFn]);
  return items;
}

function TeamTag({ name }) {
  if (!name) return null;
  return <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">{name}</span>;
}

function NoTeams() {
  return <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No teams in this organization yet.</p>;
}

// ─── KPI (was "Scorecard") ──────────────────────────────────────────────────
// Read-only glance at real weekly measurables (status computed server-side
// by app/services/kpi_service.py — the same source of truth the dedicated
// KPI Builder page uses). Data entry stays on that page rather than being
// duplicated here.

const KPI_STATUS_BADGE = {
  on_track: "bg-emerald-100 text-emerald-700",
  at_risk: "bg-amber-100 text-amber-700",
  off_track: "bg-red-100 text-red-700",
};

export function KpiSection({ extraItems = [], wide = false }) {
  const teams = useTeams();
  const aggregated = useAggregated(teams, kpiApi.list);
  // `extraItems` are KPIs created by the parent page's "+ Add" flow —
  // merged in the same way News/IDS/To-Do already do, deduped by id in
  // case the background refetch catches up with one already shown here.
  const kpis = aggregated && [
    ...extraItems.filter((k) => !aggregated.some((a) => a.id === k.id)),
    ...aggregated,
  ];

  if (teams === null || kpis === null) return <LoadingRows />;
  if (teams.length === 0) return <NoTeams />;
  if (kpis.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No measurables set up yet.</p>;
  }

  return (
    <div className={`w-full text-left ${wide ? "" : "max-w-lg"}`}>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {kpis.map((kpi) => {
          const latest = [...kpi.entries].sort((a, b) => (a.period_start < b.period_start ? 1 : -1))[0];
          const statusKey = latest ? kpi.statuses?.[latest.period_start] : null;
          return (
            <div key={kpi.id} className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-slate-800">{kpi.title}</p>
                  <TeamTag name={kpi.__teamName} />
                </div>
                <p className="text-xs text-slate-400">{kpi.owner?.full_name || "Unassigned"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">{latest?.value ?? "—"}</span>
                {kpi.reference_value != null && <span className="text-xs text-slate-400">/ {kpi.reference_value}</span>}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KPI_STATUS_BADGE[statusKey] || "bg-slate-100 text-slate-500"}`}>
                  {statusKey ? statusKey.replace("_", " ") : "No data"}
                </span>
                <Link to={`/teams/${kpi.team_id}?tab=kpis`} className="text-xs font-semibold text-blue-700 hover:underline">Open</Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Rock Review ────────────────────────────────────────────────────────────

const ROCK_STATUSES = ["on_track", "at_risk", "off_track", "complete"];
const ROCK_STATUS_LABEL = { on_track: "On-track", at_risk: "At risk", off_track: "Off-track", complete: "Done" };
const ROCK_STATUS_BADGE = {
  on_track: "bg-emerald-100 text-emerald-700", at_risk: "bg-amber-100 text-amber-700",
  off_track: "bg-red-100 text-red-700", complete: "bg-indigo-100 text-indigo-700",
};

export function RockReviewSection({ canManage, extraItems = [], wide = false }) {
  const teams = useTeams();
  const aggregated = useAggregated(teams, rockApi.list);
  // Status edits are layered on top of the fetched snapshot as overrides
  // (id -> new status) rather than copied into a separate mutable array —
  // no effect needed just to keep two copies of the same list in sync.
  // `extraItems` (rocks created by the parent page's "+ Add" flow) are
  // merged in the same way, deduped by id.
  const [statusOverrides, setStatusOverrides] = useState({});
  const merged = aggregated && [
    ...extraItems.filter((r) => !aggregated.some((a) => a.id === r.id)),
    ...aggregated,
  ];
  const rocks = merged && merged.map((r) => (statusOverrides[r.id] ? { ...r, status: statusOverrides[r.id] } : r));

  async function setStatus(rock, status) {
    try {
      const updated = await rockApi.update(rock.team_id, rock.id, { status });
      setStatusOverrides((prev) => ({ ...prev, [rock.id]: updated.status }));
    } catch (err) {
      toast.error(err.message || "Failed to update rock.");
    }
  }

  if (teams === null || rocks === null) return <LoadingRows />;
  if (teams.length === 0) return <NoTeams />;
  if (rocks.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No rocks set for this quarter.</p>;
  }

  const doneOrOnTrack = rocks.filter((r) => r.status === "complete" || r.status === "on_track").length;
  const offTrack = rocks.filter((r) => r.status === "off_track" || r.status === "at_risk").length;

  return (
    <div className={`w-full text-left ${wide ? "" : "max-w-lg"}`}>
      <div className="mb-3 flex justify-center gap-6 text-xs text-slate-500">
        <span><strong className="text-emerald-700">{doneOrOnTrack}</strong> of {rocks.length} on-track or done</span>
        <span><strong className="text-red-600">{offTrack}</strong> off-track</span>
      </div>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {rocks.map((rock) => (
          <div key={rock.id} className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-medium text-slate-800">{rock.title}</p>
                <TeamTag name={rock.__teamName} />
              </div>
              <p className="truncate text-xs text-slate-400">{rock.owner?.full_name || "Unassigned"}</p>
            </div>
            {canManage ? (
              <div className="flex shrink-0 gap-1">
                {ROCK_STATUSES.map((s) => (
                  <button key={s} type="button" onClick={() => setStatus(rock, s)}
                    className={`rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                      rock.status === s ? ROCK_STATUS_BADGE[s] : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                    }`}>
                    {ROCK_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            ) : (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ROCK_STATUS_BADGE[rock.status] || "bg-slate-100 text-slate-500"}`}>
                {ROCK_STATUS_LABEL[rock.status] || rock.status}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── News (was "Headlines") ─────────────────────────────────────────────────
// View and post news across every team — "Reviewed" = archived, a real
// persisted status change (same "active"/"archived" states the dedicated
// Team News tab uses), not a fake local checkbox. New posts go to the
// user's first accessible team — there's no team picker here anymore, so
// with more than one team this is a simplification worth knowing about;
// the item can be reassigned afterward from the Team News tab.

export function NewsSection({ canManage, extraItems = [], wide = false }) {
  const teams = useTeams();
  const aggregated = useAggregated(teams, teamNewsApi.list);
  // Freshly-posted items are kept in their own small list and prepended at
  // render time rather than copied into the fetched snapshot — `aggregated`
  // itself never needs to change, so no effect is needed to keep two
  // copies in sync. `extraItems` are items created by the parent panel
  // (e.g. the meeting toolbar's "Add News" modal) — merged in the same way.
  const [posted, setPosted] = useState([]);
  const [reviewedIds, setReviewedIds] = useState(new Set());
  const [newTitle, setNewTitle] = useState("");
  const [posting, setPosting] = useState(false);
  const news = aggregated && [
    ...posted,
    ...extraItems.filter((n) => !aggregated.some((a) => a.id === n.id) && !posted.some((p) => p.id === n.id)),
    ...aggregated.filter((n) => n.status === "active"),
  ];

  async function markReviewed(item) {
    try {
      await teamNewsApi.update(item.team_id, item.id, { status: "archived" });
      setReviewedIds((prev) => new Set(prev).add(item.id));
    } catch (err) {
      toast.error(err.message || "Failed to update news item.");
    }
  }

  async function postNews() {
    const defaultTeamId = teams?.[0]?.id;
    if (!newTitle.trim() || !defaultTeamId) return;
    setPosting(true);
    try {
      const created = await teamNewsApi.create(defaultTeamId, { title: newTitle.trim() });
      setPosted((prev) => [{ ...created, __teamName: teams[0].name }, ...prev]);
      setNewTitle("");
    } catch (err) {
      toast.error(err.message || "Failed to post news.");
    } finally {
      setPosting(false);
    }
  }

  if (teams === null || news === null) return <LoadingRows />;
  if (teams.length === 0) return <NoTeams />;

  const reviewedCount = news.filter((n) => reviewedIds.has(n.id)).length;

  return (
    <div className={`w-full text-left ${wide ? "" : "max-w-lg"}`}>
      {canManage && (
        <div className="mb-4 flex gap-2">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Post a news item…"
            onKeyDown={(e) => e.key === "Enter" && postNews()}
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <button type="button" onClick={postNews} disabled={!newTitle.trim() || posting}
            className="shrink-0 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      )}
      {news.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No news posted yet.</p>
      ) : (
        <>
          <p className="mb-3 text-center text-xs text-slate-500">{reviewedCount} of {news.length} reviewed</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {news.map((item) => {
              const isReviewed = reviewedIds.has(item.id);
              return (
                <div key={item.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className={`min-w-0 ${isReviewed ? "opacity-40" : ""}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className={`truncate text-sm font-medium text-slate-800 ${isReviewed ? "line-through" : ""}`}>{item.title}</p>
                      <TeamTag name={item.__teamName} />
                    </div>
                    {item.owner && <p className="truncate text-xs text-slate-400">{item.owner.full_name}</p>}
                  </div>
                  {canManage && (
                    <button type="button" disabled={isReviewed} onClick={() => markReviewed(item)}
                      className="shrink-0 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40">
                      {isReviewed ? "Reviewed" : "Mark Reviewed"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── To-Do List review ──────────────────────────────────────────────────────
// Meeting-native — backed by the meeting's own linked to-dos
// (meeting.meeting_tasks / meetingApi.createTask), not a team's task list.
// This is the one section that never needed a team in the first place.
// `extraTeamTasks` are real Task rows created via the toolbar's "Add To-Do"
// modal (which — unlike this section's own inline input — creates an
// actual team-scoped Task, per the "reuse CreateTodoModal, require a team
// pick" decision) — shown as a second, team-tagged group underneath so
// they appear immediately without a refresh.

export function TodoListSection({ meeting, canManage, taskName, setTaskName, onCreateTask, extraTeamTasks = [], wide = false }) {
  const openTasks = meeting.meeting_tasks.filter((mt) => mt.task?.status !== "done");
  const doneTasks = meeting.meeting_tasks.filter((mt) => mt.task?.status === "done");

  return (
    <div className={`w-full text-left ${wide ? "" : "max-w-lg"}`}>
      {canManage && (
        <div className="mb-4 flex gap-2">
          <input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="New to-do…"
            onKeyDown={(e) => e.key === "Enter" && onCreateTask()}
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <button type="button" onClick={onCreateTask} className="shrink-0 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
            Add
          </button>
        </div>
      )}
      {extraTeamTasks.length > 0 && (
        <div className="mb-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {extraTeamTasks.map((t) => (
            <div key={`team-task-${t.id}`} className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className={`truncate text-sm font-medium ${t.status === "done" ? "text-slate-400 line-through" : "text-slate-800"}`}>{t.name}</p>
                <TeamTag name={t.__teamName} />
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                t.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}>
                {t.status === "done" ? "Done" : "Not done"}
              </span>
            </div>
          ))}
        </div>
      )}
      {meeting.meeting_tasks.length === 0 && extraTeamTasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No to-dos on this meeting yet.</p>
      ) : meeting.meeting_tasks.length > 0 ? (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {[...openTasks, ...doneTasks].map((mt) => (
            <div key={mt.id} className="flex items-center justify-between gap-2 px-4 py-3">
              <p className={`min-w-0 truncate text-sm font-medium ${mt.task?.status === "done" ? "text-slate-400 line-through" : "text-slate-800"}`}>
                {mt.task?.name || `Task #${mt.task_id}`}
              </p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                mt.task?.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}>
                {mt.task?.status === "done" ? "Done" : "Not done"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── IDS (Identify, Discuss, Solve) — Issues across every accessible team ──
// New issues go to the user's first accessible team — same simplification
// as News above, for the same reason (no team picker anymore).

export function IdsSection({ canManage, extraItems = [], wide = false }) {
  const teams = useTeams();
  const aggregated = useAggregated(teams, issueApi.list);
  // Same pattern as News above: freshly-created issues and resolved ids
  // are tracked separately and merged with the fetched snapshot at render
  // time, instead of copying `aggregated` into a second mutable list.
  // `extraItems` are issues created by the parent panel (the meeting
  // toolbar's "Add Issue" modal) — merged in the same way.
  const [created, setCreated] = useState([]);
  const [resolvedIds, setResolvedIds] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState([]);
  const [begun, setBegun] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const issues = aggregated && [...created, ...extraItems, ...aggregated]
    .filter((i, idx, arr) => arr.findIndex((x) => x.id === i.id) === idx)
    .filter((i) => (i.status === "open" || i.status === "in_progress") && !resolvedIds.has(i.id));

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev; // top 3 only
      return [...prev, id];
    });
  }

  async function createIssue() {
    const defaultTeamId = teams?.[0]?.id;
    if (!newTitle.trim() || !defaultTeamId) return;
    setCreating(true);
    try {
      const createdIssue = await issueApi.create(defaultTeamId, { title: newTitle.trim() });
      setCreated((prev) => [{ ...createdIssue, __teamName: teams[0].name }, ...prev]);
      setNewTitle("");
    } catch (err) {
      toast.error(err.message || "Failed to create issue.");
    } finally {
      setCreating(false);
    }
  }

  async function resolveIssue(issue) {
    try {
      await issueApi.update(issue.team_id, issue.id, { status: "resolved" });
      setResolvedIds((prev) => new Set(prev).add(issue.id));
      setSelectedIds((prev) => prev.filter((id) => id !== issue.id));
    } catch (err) {
      toast.error(err.message || "Failed to resolve issue.");
    }
  }

  if (teams === null || issues === null) return <LoadingRows />;
  if (teams.length === 0) return <NoTeams />;

  return (
    <div className={`w-full text-left ${wide ? "" : "max-w-lg"}`}>
      {canManage && (
        <div className="mb-4 flex gap-2">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New issue…"
            onKeyDown={(e) => e.key === "Enter" && createIssue()}
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <button type="button" onClick={createIssue} disabled={!newTitle.trim() || creating}
            className="shrink-0 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
            {creating ? "Adding…" : "Add"}
          </button>
        </div>
      )}

      {issues.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No open issues. 🎉</p>
      ) : !begun ? (
        <>
          <p className="mb-3 text-sm text-slate-500">Select up to 3 issues to Identify, Discuss, and Solve.</p>
          <div className="space-y-1.5">
            {issues.map((issue) => {
              const rank = selectedIds.indexOf(issue.id);
              return (
                <button key={issue.id} type="button" onClick={() => toggleSelect(issue.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    rank >= 0 ? "border-blue-400 bg-blue-50/60" : "border-slate-200 hover:bg-slate-50"
                  }`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    rank >= 0 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"
                  }`}>
                    {rank >= 0 ? rank + 1 : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{issue.title}</span>
                  <TeamTag name={issue.__teamName} />
                </button>
              );
            })}
          </div>
          {canManage && (
            <button type="button" disabled={selectedIds.length === 0} onClick={() => setBegun(true)}
              className="mt-4 rounded-xl bg-orange-400 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50">
              Begin IDS
            </button>
          )}
        </>
      ) : (
        <>
          <button type="button" onClick={() => setBegun(false)} className="mb-3 text-xs font-medium text-slate-400 hover:text-slate-600">← Back to selection</button>
          <div className="space-y-2">
            {selectedIds.map((id) => issues.find((i) => i.id === id)).filter(Boolean).map((issue) => (
              <div key={issue.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{issue.title}</p>
                  {issue.description && <p className="truncate text-xs text-slate-400">{issue.description}</p>}
                </div>
                {canManage && (
                  <button type="button" onClick={() => resolveIssue(issue)}
                    className="shrink-0 rounded-lg border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                    Resolved
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Conclude ───────────────────────────────────────────────────────────────

export function ConcludeSection({
  meeting, canManage, selfParticipant,
  taskName, setTaskName, onCreateTask,
  decisionContent, setDecisionContent, onAddDecision, onDeleteDecision,
  onSubmitRating, onEndMeeting,
}) {
  const [rating, setRating] = useState(selfParticipant?.score ?? "");
  const [clearMeetingItems, setClearMeetingItems] = useState(true);
  const [sendEmailSummary, setSendEmailSummary] = useState(true);
  const [ending, setEnding] = useState(false);

  async function handleEnd() {
    setEnding(true);
    try {
      if (rating !== "" && Number(rating) !== selfParticipant?.score) {
        await onSubmitRating(Number(rating));
      }
      await onEndMeeting({ clearMeetingItems, sendEmailSummary });
    } finally {
      setEnding(false);
    }
  }

  return (
    <div className="w-full max-w-md text-left">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Cascading Messages</h3>
        <p className="mt-1 text-sm text-slate-500">
          Reduce communication issues and quickly recap whether any messages need to be cascaded to the organization based on decisions that were made today.
        </p>
        <div className="mt-3 flex gap-2">
          <input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="Cascading message…"
            onKeyDown={(e) => e.key === "Enter" && onCreateTask()}
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <button type="button" onClick={onCreateTask} className="mt-3 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
          Add To-Do
        </button>
      </div>

      <hr className="my-6 border-slate-200" />

      <div>
        <h3 className="text-base font-semibold text-slate-900">Key Decisions</h3>
        <p className="mt-1 text-sm text-slate-500">Recorded decisions are included in the email summary below.</p>
        {meeting.decisions.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {meeting.decisions.map((d) => (
              <div key={d.id} className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <p className="flex-1 text-sm text-slate-700">{d.content}</p>
                {canManage && (
                  <button type="button" onClick={() => onDeleteDecision(d.id)} className="shrink-0 text-slate-300 hover:text-red-500">
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {canManage && (
          <div className="mt-3 flex gap-2">
            <input value={decisionContent} onChange={(e) => setDecisionContent(e.target.value)} placeholder="Record a decision…"
              onKeyDown={(e) => e.key === "Enter" && onAddDecision()}
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <button type="button" onClick={onAddDecision} className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
              Add
            </button>
          </div>
        )}
      </div>

      <hr className="my-6 border-slate-200" />

      <div>
        <h3 className="text-base font-semibold text-slate-900">Rating</h3>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm font-medium text-slate-700">{meeting.organizer?.full_name || "You"}</span>
          <input type="number" min="0" max="10" value={rating} onChange={(e) => setRating(e.target.value)}
            className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={clearMeetingItems} onChange={(e) => setClearMeetingItems(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          Clear meeting items
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={sendEmailSummary} onChange={(e) => setSendEmailSummary(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          Send email summary
        </label>
      </div>

      {canManage && (
        <button type="button" onClick={handleEnd} disabled={ending}
          className="mt-6 rounded-xl bg-orange-400 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-60">
          {ending ? "Ending…" : "End Meeting"}
        </button>
      )}
    </div>
  );
}
