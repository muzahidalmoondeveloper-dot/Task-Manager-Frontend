import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";

import Select from "../components/Select";
import { issueApi } from "../api/issueApi";
import { userApi } from "../api/userApi";
import { projectApi } from "../api/projectApi";
import { teamApi } from "../api/teamApi";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";

const ISSUE_PRIORITY_OPTIONS = [
  { value: 0, label: "None"     },
  { value: 1, label: "Low"      },
  { value: 2, label: "Medium"   },
  { value: 3, label: "High"     },
  { value: 4, label: "Urgent"   },
  { value: 5, label: "Critical" },
];

const PRIORITY_BADGE = [
  "bg-slate-100 text-slate-600",
  "bg-slate-100 text-slate-600",
  "bg-amber-100 text-amber-700",
  "bg-orange-100 text-orange-700",
  "bg-red-100 text-red-700",
  "bg-red-200 text-red-800",
];

const ISSUE_STATUS_OPTIONS = [
  { value: "open",        label: "Open"        },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved",    label: "Resolved"    },
  { value: "closed",      label: "Closed"      },
];

const initialIssueForm = {
  title: "",
  description: "",
  team_id: "",
  project_id: "",
  assignee_id: "",
  priority: 0,
  status: "open",
  timeframe: "short-term",
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function IssuesPage() {
  const { user } = useAuth();
  const confirm = useConfirm();

  const isAdmin = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin;

  const [teams, setTeams] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [issues, setIssues] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState("all");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState(null);
  const [issueForm, setIssueForm] = useState(initialIssueForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const assignees = useMemo(
    () => users.filter((u) => ["owner", "admin", "team_manager", "team_member"].includes(u.role)),
    [users]
  );

  // Global-Issues assignee-filtering follow-up: once a Team is selected,
  // the Assignee dropdown must show ONLY that Team's eligible members —
  // sourced from the SAME canonical, Team-scoped `GET /teams/{id}/
  // assignable-users` endpoint TeamDetailPage's To-Do modal and
  // TasksPage's Team-scoped Assignee dropdown already use (never a
  // second, duplicated membership query). `assignees` above (the
  // org-wide list) remains the source whenever no Team is selected.
  const [teamAssignableUsers, setTeamAssignableUsers] = useState([]);
  useEffect(() => {
    const teamId = issueForm.team_id;
    if (!teamId) { setTeamAssignableUsers([]); return; }
    let cancelled = false;
    teamApi.getAssignableUsers(teamId)
      .then((members) => {
        if (cancelled) return;
        const list = Array.isArray(members) ? members : [];
        setTeamAssignableUsers(list);
        // Changing Team must clear/revalidate an Assignee who doesn't
        // belong to the newly selected Team — never silently leave a
        // stale, now-invalid assignee_id in the form.
        setIssueForm((current) => (
          current.assignee_id && current.team_id === teamId && !list.some((u) => String(u.id) === String(current.assignee_id))
            ? { ...current, assignee_id: "" }
            : current
        ));
      })
      .catch(() => { if (!cancelled) setTeamAssignableUsers([]); });
    return () => { cancelled = true; };
  }, [issueForm.team_id]);

  const modalAssignees = issueForm.team_id ? teamAssignableUsers : assignees;

  useEffect(() => {
    if (!isAdmin) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function load() {
    setIsLoading(true);
    try {
      const [teamData, projectData, userData] = await Promise.all([
        teamApi.list(),
        projectApi.list(),
        userApi.list(),
      ]);
      setTeams(teamData);
      setProjects(projectData);
      setUsers(userData);

      const perTeam = await Promise.all(
        teamData.map((t) =>
          issueApi.list(t.id).then(
            (data) => (Array.isArray(data) ? data.map((i) => ({ ...i, team_name: t.name })) : []),
            () => []
          )
        )
      );
      const merged = perTeam.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setIssues(merged);
    } catch (err) {
      toast.error(err.message || "Unable to load issues.");
    } finally {
      setIsLoading(false);
    }
  }

  function openCreateModal() {
    setEditingIssue(null);
    setIssueForm(initialIssueForm);
    setFormError("");
    setIsModalOpen(true);
  }

  // Global-Issues Edit follow-up: pre-fills the SAME modal/form state
  // Create already uses (Title/Description/Team/Project/Assignee/
  // Priority, plus Status — Edit-only, Create never sends it, matching
  // the existing IssueCreate default of "open") — never a second,
  // duplicated form. Setting `team_id` here is what makes the existing
  // Team->Assignee-filtering effect (see `teamAssignableUsers` above)
  // immediately fetch and scope this Team's eligible members, exactly
  // like a user picking that Team by hand.
  function openEditModal(issue) {
    setEditingIssue(issue);
    setIssueForm({
      title: issue.title || "",
      description: issue.description || "",
      team_id: issue.team_id ? String(issue.team_id) : "",
      project_id: issue.project_id ? String(issue.project_id) : "",
      assignee_id: issue.assignee_id ? String(issue.assignee_id) : "",
      priority: issue.priority ?? 0,
      status: issue.status || "open",
      timeframe: issue.timeframe || "short-term",
    });
    setFormError("");
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingIssue(null);
    setFormError("");
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setIssueForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!issueForm.team_id) {
      setFormError("Please select a team for this issue.");
      return;
    }
    setIsSubmitting(true);
    setFormError("");
    try {
      const team = teams.find((t) => t.id === Number(issueForm.team_id));
      if (editingIssue) {
        // Reuses the existing PATCH /teams/{team_id}/issues/{issue_id}
        // endpoint — never a new route. The URL's team_id is the Issue's
        // ORIGINAL team (required to look it up); a changed Team is sent
        // in the body, same as the backend's own team-move handling.
        const updated = await issueApi.update(editingIssue.team_id, editingIssue.id, {
          title: issueForm.title,
          description: issueForm.description || null,
          team_id: Number(issueForm.team_id),
          project_id: issueForm.project_id ? Number(issueForm.project_id) : null,
          assignee_id: issueForm.assignee_id ? Number(issueForm.assignee_id) : null,
          priority: Number(issueForm.priority),
          status: issueForm.status,
        });
        setIssues((prev) => prev.map((i) => (i.id === editingIssue.id ? { ...updated, team_name: team?.name || "" } : i)));
        toast.success("Issue updated.");
      } else {
        const created = await issueApi.create(Number(issueForm.team_id), {
          title: issueForm.title,
          description: issueForm.description || null,
          project_id: issueForm.project_id ? Number(issueForm.project_id) : null,
          assignee_id: issueForm.assignee_id ? Number(issueForm.assignee_id) : null,
          priority: Number(issueForm.priority),
          timeframe: issueForm.timeframe,
        });
        setIssues((prev) => [{ ...created, team_name: team?.name || "" }, ...prev]);
        toast.success("Issue created.");
      }
      closeModal();
    } catch (err) {
      const message = err.message || (editingIssue ? "Unable to update issue." : "Unable to create issue.");
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(issue) {
    if (!(await confirm({ message: `Delete "${issue.title}"?`, tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await issueApi.delete(issue.team_id, issue.id);
      setIssues((prev) => prev.filter((i) => i.id !== issue.id));
      toast.success("Issue deleted.");
    } catch (err) {
      toast.error(err.message || "Unable to delete issue.");
    }
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const filteredIssues = teamFilter === "all" ? issues : issues.filter((i) => String(i.team_id) === teamFilter);

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Issues</h1>
          <p className="mt-1 text-sm text-slate-500">Track and manage issues reported against a team.</p>
        </div>
        <button type="button" onClick={openCreateModal}
          className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
          + Create Issue
        </button>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team</label>
        <Select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700">
          <option value="all">All Teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Title</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Team</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Project</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Assignee</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Priority</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Created</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">Loading issues...</td></tr>
              ) : filteredIssues.length ? (
                filteredIssues.map((issue) => (
                  <tr key={issue.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-4 align-middle font-medium text-slate-900">{issue.title}</td>
                    <td className="px-4 py-4 align-middle text-slate-600">{issue.team_name || "—"}</td>
                    <td className="px-4 py-4 align-middle text-slate-600">{issue.project?.name || "—"}</td>
                    <td className="px-4 py-4 align-middle text-slate-600">{issue.assignee?.full_name || "Unassigned"}</td>
                    <td className="px-4 py-4 align-middle">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_BADGE[issue.priority] || PRIORITY_BADGE[0]}`}>
                        {ISSUE_PRIORITY_OPTIONS.find((o) => o.value === issue.priority)?.label || "None"}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-middle capitalize text-slate-600">{(issue.status || "open").replace("_", " ")}</td>
                    <td className="px-4 py-4 align-middle text-slate-500">{formatDate(issue.created_at)}</td>
                    <td className="px-4 py-4 text-right align-middle">
                      <button type="button" onClick={() => openEditModal(issue)}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                        Edit
                      </button>
                      <button type="button" onClick={() => handleDelete(issue)}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-sm text-slate-500">No issues yet. Click "Create Issue" to report one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{editingIssue ? "Edit Issue" : "Create Issue"}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {editingIssue ? "Update this issue's details." : "Report a problem and track it against a team."}
                </p>
              </div>
              <button type="button" onClick={closeModal}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            {formError && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Title *</label>
                <input name="title" value={issueForm.title} onChange={handleChange} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
                <textarea name="description" value={issueForm.description} onChange={handleChange} rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Team *</label>
                  <Select name="team_id" value={issueForm.team_id} onChange={handleChange} required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Select team</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Project</label>
                  <Select name="project_id" value={issueForm.project_id} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">No project</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Assignee</label>
                  <Select name="assignee_id" value={issueForm.assignee_id} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Unassigned</option>
                    {modalAssignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Priority</label>
                  <Select name="priority" value={issueForm.priority} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {ISSUE_PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>

              {/* Status is Edit-only — Create always starts an Issue at
                  the existing IssueCreate default ("open"); this reuses
                  the same PATCH endpoint's own `status` field, unchanged. */}
              {editingIssue && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                  <Select name="status" value={issueForm.status} onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {ISSUE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {isSubmitting ? "Saving…" : editingIssue ? "Save Changes" : "Create Issue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
