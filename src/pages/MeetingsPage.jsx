import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { meetingApi } from "../api/meetingApi";
import { teamApi } from "../api/teamApi";
import { useAuth } from "../context/AuthContext";
import CreateMeetingModal from "../components/meetings/CreateMeetingModal";
import { MeetingCard, LiveMeetingPanel } from "./MeetingsTab";

/**
 * Org-wide Meetings page (sidebar, right after Users) — aggregates meetings
 * across every team the current user can see (plus any org-wide, team-less
 * meeting), so everyone can find and join one from a single place instead
 * of hunting through each team's own Meetings tab. Reuses MeetingsTab's
 * MeetingCard/LiveMeetingPanel directly rather than re-implementing the
 * join/agenda/notes/decisions/check-in experience a second time.
 *
 * Meetings are not team-specific — "+ Create Meeting" here opens the same
 * CreateMeetingModal used on a team's own tab, but with an optional Team
 * picker (defaulting to "no team") instead of one locked in.
 */
const FILTER_TABS = [
  { id: "", label: "All" },
  { id: "scheduled", label: "Upcoming" },
  { id: "ongoing", label: "Ongoing" },
  { id: "completed", label: "Completed" },
];

export default function MeetingsPage() {
  const { user } = useAuth();
  const canManage = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin || user?.role === "team_manager";

  const [meetings, setMeetings] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [liveMeeting, setLiveMeeting] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await meetingApi.list(filter || undefined);
      setMeetings(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.message || "Failed to load meetings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    teamApi.list().then(setTeams).catch(() => {});
  }, []);

  async function handleCreate(payload) {
    const created = await meetingApi.create(payload);
    setMeetings((prev) => [created, ...prev]);
    toast.success("Meeting created.");
  }

  function handleUpdate(updated) {
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
    if (liveMeeting?.id === updated.id) setLiveMeeting((current) => ({ ...current, ...updated }));
  }

  const filtered = meetings.filter((m) => !search || m.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Meetings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every meeting across your teams, in one place — open one to join and follow along.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex w-fit items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Create Meeting
        </button>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === tab.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
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
              className="w-56 rounded-xl border border-slate-200 py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

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
              <p className="mt-1 text-xs text-slate-400">Create one — it doesn't need to belong to a team.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((m) => (
                <MeetingCard key={m.id} meeting={m} canManage={false} onOpen={setLiveMeeting} />
              ))}
            </div>
          )}
        </div>
      </section>

      {showCreateModal && (
        <CreateMeetingModal
          teams={teams}
          teamMembers={[]}
          onSave={handleCreate}
          onClose={() => setShowCreateModal(false)}
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
    </div>
  );
}
