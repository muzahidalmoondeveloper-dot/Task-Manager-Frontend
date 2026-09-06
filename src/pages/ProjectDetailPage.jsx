import { useEffect, useMemo, useState } from "react";
import Select from "../components/Select";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { projectApi } from "../api/projectApi";
import { resolveMediaUrl } from "../api/client";
import { taskApi } from "../api/taskApi";
import { userApi } from "../api/userApi";
import { teamApi } from "../api/teamApi";
import { reportApi } from "../api/reportApi";
import { clientInvitationApi } from "../api/clientInvitationApi";
import { taskRequestApi } from "../api/taskRequestApi";
import { issueApi } from "../api/issueApi";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import DatePicker from "../components/DatePicker";
import TaskTimeTracker from "../components/TaskTimeTracker";
import WorkingTimeCell from "../components/WorkingTimeCell";
import { formatDurationSeconds, formatLiveDurationSeconds } from "../utils/duration";
import { useLiveDuration } from "../hooks/useLiveDuration";
import StartOnboardingModal from "../components/onboarding/StartOnboardingModal";
import InvitationsTable from "../components/onboarding/InvitationsTable";
import { getDueRowClassName } from "../utils/taskDueStatus";
import { filterOrgAssignableUsers, getInlineAssigneeOptions } from "../utils/taskAssignees";

const TASK_REQUEST_STATUS_BADGE = {
  pending: "bg-amber-100 text-amber-700",
  converted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

const PROJECT_STATUS_BADGE = {
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  inactive: "bg-slate-200 text-slate-600",
  completed: "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-700",
};

function getProjectStatusBadge(status) {
  return PROJECT_STATUS_BADGE[status] || "bg-slate-100 text-slate-700";
}

const STATUS_OPTIONS = [
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

const PRIORITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const ISSUE_PRIORITY_OPTIONS = [
  { value: 0, label: "None"     },
  { value: 1, label: "Low"      },
  { value: 2, label: "Medium"   },
  { value: 3, label: "High"     },
  { value: 4, label: "Urgent"   },
  { value: 5, label: "Critical" },
];

const initialIssueForm = {
  title: "",
  description: "",
  team_id: "",
  priority: 0,
};

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

function getProjectInitials(name) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const initialForm = {
  name: "",
  description: "",
  start_date: "",
  due_date: "",
  assignee_id: "",
  team_id: "",
  status: "todo",
};

function formatDate(dateString) {
  if (!dateString) return "";
  return new Date(`${dateString}T00:00:00`).toLocaleDateString();
}

function getStatusLabel(status) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status;
}

function getStatusBadgeClass(status) {
  if (status === "done") {
    return "inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700";
  }

  if (status === "in_progress") {
    return "inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700";
  }

  return "inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700";
}

function getMonthMatrix(year, monthIndex) {
  const firstDay = new Date(year, monthIndex, 1);
  const firstCalendarDay = new Date(firstDay);
  firstCalendarDay.setDate(firstCalendarDay.getDate() - firstDay.getDay());

  const days = [];

  for (let i = 0; i < 42; i += 1) {
    const current = new Date(firstCalendarDay);
    current.setDate(firstCalendarDay.getDate() + i);
    days.push(current);
  }

  return days;
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function ThreeDotsIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM18 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "overview";
  function setActiveTab(tabId) {
    setSearchParams({ tab: tabId });
  }

  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  // Project Working Time (#7B) — a self-contained aggregate loaded
  // independently of the rest of Project Detail (see loadWorkingTime),
  // so a failure here never blanks out the rest of the page. Live display
  // while any timer is active is display-only ticking off the server's
  // own baseline+timestamp; a fresh loadWorkingTime() call always resets
  // it to the authoritative value.
  const [workingTimeSummary, setWorkingTimeSummary] = useState(null);
  // Per-task Working Time for the "list" tab's task table — keyed by task
  // id, populated in bulk (never one request per row; see refreshTaskWorkingTimes).
  const [taskWorkingTimes, setTaskWorkingTimes] = useState({});
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [reports, setReports] = useState([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isCreatingReport, setIsCreatingReport] = useState(false);
  const [reportForm, setReportForm] = useState({ report_type: "monthly", title: "", period_start: "", period_end: "" });

  const [clientInvitations, setClientInvitations] = useState([]);
  const [isLoadingClientInvitations, setIsLoadingClientInvitations] = useState(false);
  const [isInviteClientModalOpen, setIsInviteClientModalOpen] = useState(false);

  const [taskRequests, setTaskRequests] = useState([]);
  const [isLoadingTaskRequests, setIsLoadingTaskRequests] = useState(false);
  const [convertingRequest, setConvertingRequest] = useState(null);
  const [convertForm, setConvertForm] = useState({ team_id: "", assignee_id: "", priority: "medium", due_date: "" });
  const [isConvertingRequest, setIsConvertingRequest] = useState(false);

  const [formData, setFormData] = useState(initialForm);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState(null);

  const [calendarDate, setCalendarDate] = useState(new Date());

  const [rocks, setRocks] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [issues, setIssues] = useState([]);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [issueForm, setIssueForm] = useState(initialIssueForm);
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [objectives, setObjectives] = useState([]);
  const [objectiveRocks, setObjectiveRocks] = useState([]);
  const [rockKpis, setRockKpis] = useState([]);
  const [projectTeams, setProjectTeams] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const [error, setError] = useState("");

  const isEditing = editingTaskId !== null;
  const canManageTasks = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin || user?.role === "team_manager";
  // Project Managers can create tasks under their assigned project(s) and set
  // the team, but cannot edit/delete/change status on tasks (backend-enforced
  // create-only scope) — kept as a separate flag so those controls stay
  // manager-only below.
  const canCreateTasks = canManageTasks || user?.role === "project_manager" || user?.is_project_manager;
  // The "Assign Team" dropdown in Create Task: Owners/Admins/Team Managers
  // keep seeing their existing org-wide-or-managed team list (`teams`, from
  // GET /teams — unchanged). A plain Project Manager (canCreateTasks but not
  // canManageTasks) isn't a team manager/member of anything, so GET /teams
  // legitimately returns nothing for them — instead they get `projectTeams`,
  // the teams already scoped to *this* project (GET /projects/{id}/items,
  // gated by the same require_project_access() check that let them open
  // this project at all), never the full org list.
  const assignableTeams = (canCreateTasks && !canManageTasks) ? projectTeams : teams;
  const canManageProjects = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin || user?.role === "team_manager";

  async function handleLogoFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!LOGO_ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Logo must be a PNG, JPEG, or WEBP image.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Logo must be smaller than 5 MB.");
      return;
    }

    try {
      setIsUploadingLogo(true);
      const updated = await projectApi.uploadLogo(projectId, file);
      setProject(updated);
      toast.success("Project logo updated.");
    } catch (err) {
      toast.error(err.message || "Failed to upload logo.");
    } finally {
      setIsUploadingLogo(false);
    }
  }

  async function handleRemoveLogo() {
    const ok = await confirm({ message: "Remove this project's logo?", tone: "danger", confirmLabel: "Remove" });
    if (!ok) return;
    try {
      setIsUploadingLogo(true);
      const updated = await projectApi.deleteLogo(projectId);
      setProject(updated);
      toast.success("Project logo removed.");
    } catch (err) {
      toast.error(err.message || "Failed to remove logo.");
    } finally {
      setIsUploadingLogo(false);
    }
  }

  // Rule F fallback (Task Assignee bug-fix follow-up): eligible assignees
  // when the Task being edited has no team_id — org-wide, minus Client
  // (see utils/taskAssignees.js, shared with TasksPage/TeamDetailPage
  // instead of a separately-maintained role allowlist here).
  const assignees = useMemo(() => filterOrgAssignableUsers(users), [users]);

  // Task Assignee bug-fix follow-up (Rule B/C): once a Team is picked in
  // the Edit Task modal, the Assignee dropdown must be scoped to THAT
  // team's eligible members only — never the whole organization, and
  // never widened by Admin/Owner/Team-Manager privilege. Fetched via the
  // same team-scoped `GET /teams/{id}/assignable-users` TeamDetailPage
  // uses.
  const [teamAssignableUsers, setTeamAssignableUsers] = useState([]);
  useEffect(() => {
    const teamId = formData.team_id;
    Promise.resolve(teamId ? teamApi.getAssignableUsers(teamId) : [])
      .then((members) => setTeamAssignableUsers(Array.isArray(members) ? members : []))
      .catch(() => setTeamAssignableUsers([]));
  }, [formData.team_id]);

  // The dropdown's actual option source: Team eligibility wins whenever a
  // team is selected (Rule B/C precedence), org-wide list otherwise.
  const modalAssignees = formData.team_id ? teamAssignableUsers : assignees;

  // Same Team-scoping, independently, for the Task Request -> Task
  // conversion form below (`convertForm`) — its own Team field is always
  // required, so this is always a Team Task once submitted.
  const [convertTeamAssignableUsers, setConvertTeamAssignableUsers] = useState([]);
  useEffect(() => {
    const teamId = convertForm.team_id;
    Promise.resolve(teamId ? teamApi.getAssignableUsers(teamId) : [])
      .then((members) => setConvertTeamAssignableUsers(Array.isArray(members) ? members : []))
      .catch(() => setConvertTeamAssignableUsers([]));
  }, [convertForm.team_id]);

  // Inline-assignee-dropdown bug-fix follow-up: the INLINE quick-assignee
  // `<Select>` in the project's task table needs options for however
  // many DISTINCT teams are represented across the project's currently
  // loaded tasks — ONE bulk request for all of them, never one per row
  // and never one per unique team either. Keyed by team id (string,
  // matching the API's JSON keys) so a Technology Team task's row never
  // sees Marketing's members, even within the same project.
  const [assignableUsersByTeamId, setAssignableUsersByTeamId] = useState({});
  const [assignableUsersLoading, setAssignableUsersLoading] = useState(false);
  const visibleTeamIds = useMemo(() => {
    const ids = new Set();
    for (const t of tasks) if (t.team_id != null) ids.add(t.team_id);
    return Array.from(ids).sort((a, b) => a - b);
  }, [tasks]);
  const visibleTeamIdsKey = visibleTeamIds.join(",");

  useEffect(() => {
    Promise.resolve().then(async () => {
      if (!visibleTeamIds.length) {
        setAssignableUsersByTeamId({});
        return;
      }
      setAssignableUsersLoading(true);
      try {
        const data = await teamApi.getAssignableUsersBulk(visibleTeamIds);
        setAssignableUsersByTeamId(data?.teams || {});
      } catch {
        setAssignableUsersByTeamId({});
      } finally {
        setAssignableUsersLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTeamIdsKey]);

  const groupedByStatus = useMemo(() => {
    return STATUS_OPTIONS.reduce((acc, status) => {
      acc[status.value] = tasks.filter((task) => task.status === status.value);
      return acc;
    }, {});
  }, [tasks]);

  const tasksByDueDate = useMemo(() => {
    return tasks.reduce((acc, task) => {
      if (!task.due_date) return acc;

      if (!acc[task.due_date]) {
        acc[task.due_date] = [];
      }

      acc[task.due_date].push(task);

      return acc;
    }, {});
  }, [tasks]);

  const calendarDays = useMemo(() => {
    return getMonthMatrix(calendarDate.getFullYear(), calendarDate.getMonth());
  }, [calendarDate]);

  // Project rocks + rocks under the project's objectives, deduped by id.
  const allProjectRocks = useMemo(() => {
    const map = new Map();
    [...rocks, ...objectiveRocks].forEach((r) => map.set(r.id, r));
    return Array.from(map.values());
  }, [rocks, objectiveRocks]);

  // Project KPIs + KPIs tracking any of the rocks above, deduped by id.
  const allProjectKpis = useMemo(() => {
    const map = new Map();
    [...kpis, ...rockKpis].forEach((k) => map.set(k.id, k));
    return Array.from(map.values());
  }, [kpis, rockKpis]);

  const doneTaskCount = useMemo(() => {
    return tasks.filter((task) => task.status === "done").length;
  }, [tasks]);

  const inProgressTaskCount = useMemo(() => {
    return tasks.filter((task) => task.status === "in_progress").length;
  }, [tasks]);

  const todoTaskCount = useMemo(() => {
    return tasks.filter((task) => task.status === "todo").length;
  }, [tasks]);

  async function loadData() {
    try {
      setIsLoading(true);
      setError("");

      const requests = [
        projectApi.getById(projectId),
        taskApi.listByProject(projectId),
        projectApi.listItems(projectId),
      ];

      if (canCreateTasks) {
        // userApi.list() is org-admin-only (GET /users); a Project Manager
        // legitimately gets a 403 here. Don't let that sink the whole
        // Promise.all and blank out the entire project page over it — just
        // degrade to an empty assignee list.
        requests.push(userApi.list().catch(() => []));
        requests.push(teamApi.list());
      }

      const result = await Promise.all(requests);

      setProject(result[0]);
      setTasks(result[1]);
      setRocks(result[2]?.rocks || []);
      setKpis(result[2]?.kpis || []);
      setIssues(result[2]?.issues || []);
      setObjectives(result[2]?.objectives || []);
      setObjectiveRocks(result[2]?.objective_rocks || []);
      setRockKpis(result[2]?.rock_kpis || []);
      setProjectTeams(result[2]?.teams || []);

      if (canCreateTasks) {
        setUsers(result[3]);
        setTeams(result[4]);
      }
    } catch (err) {
      setError(err.message || "Unable to load project.");
      toast.error(err.message || "Unable to load project.");
    } finally {
      setIsLoading(false);
    }
  }

  // Deliberately independent of loadData()'s Promise.all — a Working Time
  // failure (e.g. a client without project access) must never blank out
  // the rest of Project Detail, matching how the optional users/teams
  // requests above already degrade gracefully rather than sink everything.
  async function loadWorkingTime() {
    try {
      const data = await projectApi.getWorkingTime(projectId);
      setWorkingTimeSummary(data);
    } catch {
      // Silently leave the stat card at its zero/loading state — this is a
      // secondary metric, not core Project Detail data.
    }
  }

  useEffect(() => {
    if (!projectId) return;
    loadWorkingTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Display-only ticking while one or more timers are active in this
  // project — shared baseline+monotonic-elapsed hook (Task List Working
  // Time follow-up), reconstructed from the server's own authoritative
  // values, never persisted. A fresh loadWorkingTime() (e.g. via
  // TaskTimeTracker's onTimeChange after Start/Stop) always replaces the
  // baseline with the authoritative value.
  const displayWorkingTimeSeconds = useLiveDuration(
    workingTimeSummary?.working_time_seconds ?? 0,
    workingTimeSummary?.active_timer_count ?? 0
  );

  // Bulk Working Time for the "list" tab's task table — ONE request for
  // every task currently loaded on this page, never one per row (Task
  // List Working Time follow-up). Independent of loadData()/loadWorkingTime()
  // so a failure here never blanks out the rest of Project Detail.
  // #7A allows only ONE active timer per user across the whole org — this
  // tracks whether the CALLER (never another user) already has one
  // running, so every OTHER row's Start button can be disabled instead of
  // letting the user discover a 409 only after clicking (Start/Stop-from-
  // list follow-up). Per-row "is it MY timer" comes from each item's own
  // `current_user_is_active` — never from `active_timer_count`, which
  // describes the task aggregate and may be > 0 purely because another
  // user is timing it.
  const [currentUserHasActiveTimer, setCurrentUserHasActiveTimer] = useState(false);

  async function refreshTaskWorkingTimes() {
    if (!tasks.length) {
      setTaskWorkingTimes({});
      setCurrentUserHasActiveTimer(false);
      return;
    }
    try {
      const data = await taskApi.getTimeSummaries(tasks.map((t) => t.id));
      setTaskWorkingTimes(data.items || {});
      setCurrentUserHasActiveTimer(Boolean(data.current_user_has_active_timer));
    } catch {
      // Leave whatever was last successfully loaded (or the zero-state) —
      // Working Time is a secondary metric on this list, not core data.
    }
  }

  useEffect(() => {
    refreshTaskWorkingTimes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  useEffect(() => {
    loadData();
    resetForm();
    setActiveTab("overview");
  }, [projectId, canCreateTasks]);

  useEffect(() => {
    if (activeTab !== "reports") return;

    async function loadReports() {
      try {
        setIsLoadingReports(true);
        const data = await reportApi.list({ project_id: projectId });
        setReports(data);
      } catch (err) {
        toast.error(err.message || "Failed to load reports.");
      } finally {
        setIsLoadingReports(false);
      }
    }

    loadReports();
  }, [activeTab, projectId]);

  function openCreateReportModal() {
    setReportForm({
      report_type: "monthly",
      title: `${project?.name || "Project"} - Monthly Project Report`,
      period_start: "",
      period_end: "",
    });
    setIsReportModalOpen(true);
  }

  function handleReportFormChange(event) {
    const { name, value } = event.target;
    setReportForm((current) => ({ ...current, [name]: value }));
  }

  async function handleCreateReport(event) {
    event.preventDefault();
    try {
      setIsCreatingReport(true);
      const created = await reportApi.create({
        project_id: Number(projectId),
        report_type: reportForm.report_type,
        title: reportForm.title,
        period_start: reportForm.period_start || null,
        period_end: reportForm.period_end || null,
      });
      navigate(`/reports/${created.id}/edit`);
    } catch (err) {
      toast.error(err.message || "Failed to create report.");
    } finally {
      setIsCreatingReport(false);
    }
  }

  async function handleDeleteReport(report) {
    const ok = await confirm({ message: `Delete "${report.title}"? This cannot be undone.`, tone: "danger", confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await reportApi.remove(report.id);
      setReports((current) => current.filter((r) => r.id !== report.id));
      toast.success("Report deleted.");
    } catch (err) {
      toast.error(err.message || "Failed to delete report.");
    }
  }


  async function loadClientInvitations() {
    try {
      setIsLoadingClientInvitations(true);
      const data = await clientInvitationApi.list(projectId);
      setClientInvitations(data);
    } catch (err) {
      toast.error(err.message || "Failed to load client invitations.");
    } finally {
      setIsLoadingClientInvitations(false);
    }
  }

  useEffect(() => {
    if (!canCreateTasks) return;
    loadClientInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, canCreateTasks]);

  async function handleResendClientInvitation(invitationId) {
    try {
      await clientInvitationApi.resend(invitationId);
      toast.success("Invitation resent.");
      await loadClientInvitations();
    } catch (err) {
      toast.error(err.message || "Failed to resend invitation.");
    }
  }

  async function handleDeleteDraftInvitation(invitationId) {
    const ok = await confirm({ message: "Delete this draft invitation?", tone: "danger", confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await clientInvitationApi.deleteDraft(invitationId);
      setClientInvitations((current) => current.filter((inv) => inv.id !== invitationId));
      toast.success("Draft deleted.");
    } catch (err) {
      toast.error(err.message || "Failed to delete draft.");
    }
  }

  async function handleRemoveInvitation(invitationId) {
    const ok = await confirm({ message: "Remove this invitation from the list?", tone: "danger", confirmLabel: "Remove" });
    if (!ok) return;
    try {
      await clientInvitationApi.deleteDraft(invitationId);
      setClientInvitations((current) => current.filter((inv) => inv.id !== invitationId));
      toast.success("Invitation removed.");
    } catch (err) {
      toast.error(err.message || "Failed to remove invitation.");
    }
  }

  async function handleRevokeClientInvitation(invitationId) {
    const ok = await confirm({ message: "Revoke this client invitation?", tone: "danger", confirmLabel: "Revoke" });
    if (!ok) return;
    try {
      await clientInvitationApi.revoke(invitationId);
      await loadClientInvitations();
      toast.success("Invitation revoked.");
    } catch (err) {
      toast.error(err.message || "Failed to revoke invitation.");
    }
  }

  async function loadTaskRequests() {
    try {
      setIsLoadingTaskRequests(true);
      const data = await taskRequestApi.list(projectId);
      setTaskRequests(data);
    } catch (err) {
      toast.error(err.message || "Failed to load task requests.");
    } finally {
      setIsLoadingTaskRequests(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "task requests") return;
    loadTaskRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, projectId]);

  function openConvertModal(request) {
    setConvertingRequest(request);
    setConvertForm({ team_id: "", assignee_id: "", priority: "medium", due_date: "" });
  }

  function handleConvertFormChange(event) {
    const { name, value } = event.target;
    setConvertForm((current) => ({ ...current, [name]: value }));
  }

  async function handleConvertRequest(event) {
    event.preventDefault();
    if (!convertForm.team_id) return;
    try {
      setIsConvertingRequest(true);
      const updated = await taskRequestApi.convert(projectId, convertingRequest.id, {
        team_id: Number(convertForm.team_id),
        assignee_id: convertForm.assignee_id ? Number(convertForm.assignee_id) : null,
        priority: convertForm.priority,
        due_date: convertForm.due_date || null,
      });
      setTaskRequests((current) => current.map((r) => (r.id === updated.id ? updated : r)));
      setConvertingRequest(null);
      toast.success("Task request converted into a task.");
    } catch (err) {
      toast.error(err.message || "Failed to convert task request.");
    } finally {
      setIsConvertingRequest(false);
    }
  }

  async function handleRejectRequest(request) {
    const ok = await confirm({ message: `Reject "${request.title}"?`, tone: "danger", confirmLabel: "Reject" });
    if (!ok) return;
    try {
      const updated = await taskRequestApi.reject(projectId, request.id);
      setTaskRequests((current) => current.map((r) => (r.id === updated.id ? updated : r)));
      toast.success("Task request rejected.");
    } catch (err) {
      toast.error(err.message || "Failed to reject task request.");
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function resetForm() {
    setFormData(initialForm);
    setEditingTaskId(null);
    setError("");
  }

  function openCreateModal() {
    resetForm();
    setOpenActionMenuId(null);
    setIsTaskModalOpen(true);
  }

  function closeTaskModal() {
    resetForm();
    setIsTaskModalOpen(false);
  }

  function openIssueModal() {
    setIssueForm(initialIssueForm);
    setIssueError("");
    setIsIssueModalOpen(true);
  }

  function closeIssueModal() {
    setIsIssueModalOpen(false);
    setIssueError("");
  }

  function handleIssueChange(e) {
    const { name, value } = e.target;
    setIssueForm((current) => ({ ...current, [name]: value }));
  }

  async function handleIssueSubmit(e) {
    e.preventDefault();
    if (!issueForm.team_id) {
      setIssueError("Please select a team for this issue.");
      return;
    }
    setIsSubmittingIssue(true);
    setIssueError("");
    try {
      const created = await issueApi.create(Number(issueForm.team_id), {
        title: issueForm.title,
        description: issueForm.description || null,
        project_id: project.id,
        priority: Number(issueForm.priority),
      });
      setIssues((prev) => [created, ...prev]);
      toast.success("Issue created.");
      closeIssueModal();
    } catch (err) {
      setIssueError(err.message || "Unable to create issue.");
      toast.error(err.message || "Unable to create issue.");
    } finally {
      setIsSubmittingIssue(false);
    }
  }

  function handleEdit(task) {
    setOpenActionMenuId(null);
    setEditingTaskId(task.id);

    setFormData({
      name: task.name || "",
      description: task.description || "",
      start_date: task.start_date || "",
      due_date: task.due_date || "",
      assignee_id: task.assignee_id ? String(task.assignee_id) : "",
      team_id: task.team_id ? String(task.team_id) : "",
      status: task.status || "todo",
    });

    setError("");
    setIsTaskModalOpen(true);
  }

  function toggleActionMenu(taskId) {
    setOpenActionMenuId((current) => (current === taskId ? null : taskId));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setIsSubmitting(true);
      setError("");

      const payload = {
        name: formData.name,
        description: formData.description || null,
        start_date: formData.start_date || null,
        due_date: formData.due_date || null,
        // New tasks are created unassigned; assignment happens later (edit).
        assignee_id: isEditing && formData.assignee_id ? Number(formData.assignee_id) : null,
        project_id: Number(projectId),
        team_id: formData.team_id ? Number(formData.team_id) : null,
        status: formData.status,
      };

      if (isEditing) {
        const updatedTask = await taskApi.update(editingTaskId, payload);

        setTasks((current) =>
          current.map((task) =>
            task.id === editingTaskId ? updatedTask : task
          )
        );

        toast.success("Task updated successfully.");
      } else {
        const createdTask = await taskApi.create(payload);

        setTasks((current) => [createdTask, ...current]);

        toast.success("Task created successfully.");
      }

      closeTaskModal();
    } catch (err) {
      setError(err.message || "Unable to save task.");
      toast.error(err.message || "Unable to save task.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(task) {
    setOpenActionMenuId(null);

    const confirmed = await confirm({ message: `Delete ${task.name}?`, tone: "danger", confirmLabel: "Delete" });

    if (!confirmed) return;

    try {
      setError("");

      await taskApi.delete(task.id);

      setTasks((current) => current.filter((item) => item.id !== task.id));

      if (editingTaskId === task.id) {
        closeTaskModal();
      }

      toast.success("Task deleted successfully.");
    } catch (err) {
      setError(err.message || "Unable to delete task.");
      toast.error(err.message || "Unable to delete task.");
    }
  }

  async function quickStatusUpdate(task, status) {
    try {
      setOpenActionMenuId(null);
      setError("");

      const updatedTask = await taskApi.updateStatus(task.id, status);

      setTasks((current) =>
        current.map((item) => (item.id === task.id ? updatedTask : item))
      );

      toast.success("Task status updated.");
    } catch (err) {
      setError(err.message || "Unable to update task status.");
      toast.error(err.message || "Unable to update task status.");
    }
  }

  async function quickPriorityUpdate(task, priority) {
    try {
      const updatedTask = await taskApi.update(task.id, { priority });
      setTasks((current) => current.map((item) => (item.id === task.id ? updatedTask : item)));
      toast.success("Task priority updated.");
    } catch (err) {
      toast.error(err.message || "Unable to update task priority.");
    }
  }

  async function quickAssigneeUpdate(task, assigneeId) {
    try {
      const updatedTask = await taskApi.update(task.id, { assignee_id: assigneeId ? Number(assigneeId) : null });
      setTasks((current) => current.map((item) => (item.id === task.id ? updatedTask : item)));
      toast.success("Task assignee updated.");
    } catch (err) {
      toast.error(err.message || "Unable to update task assignee.");
    }
  }

  function goToPreviousMonth() {
    setCalendarDate(
      new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1)
    );
  }

  function goToNextMonth() {
    setCalendarDate(
      new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1)
    );
  }

  function goToToday() {
    setCalendarDate(new Date());
  }

  function getRockStatusCfg(status) {
    const map = {
      backlog:   { dot: "bg-slate-400",   badge: "bg-slate-100 text-slate-700",   label: "Backlog" },
      planned:   { dot: "bg-blue-400",    badge: "bg-blue-100 text-blue-700",     label: "Planned" },
      on_track:  { dot: "bg-teal-500",    badge: "bg-teal-100 text-teal-700",     label: "On Track" },
      at_risk:   { dot: "bg-amber-400",   badge: "bg-amber-100 text-amber-700",   label: "At Risk" },
      off_track: { dot: "bg-orange-500",  badge: "bg-orange-100 text-orange-700", label: "Off Track" },
      complete:  { dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", label: "Complete" },
      canceled:  { dot: "bg-red-400",     badge: "bg-red-100 text-red-700",       label: "Canceled" },
      archived:  { dot: "bg-slate-300",   badge: "bg-slate-100 text-slate-500",   label: "Archived" },
    };
    return map[status] || map.backlog;
  }

  function getObjectiveStatusCfg(status) {
    const map = {
      active:    { label: "Active",    badge: "bg-blue-100 text-blue-700" },
      completed: { label: "Completed", badge: "bg-emerald-100 text-emerald-700" },
      paused:    { label: "Paused",    badge: "bg-amber-100 text-amber-700" },
      cancelled: { label: "Cancelled", badge: "bg-red-100 text-red-700" },
    };
    return map[status] || map.active;
  }

  function getIssuePriorityCfg(priority) {
    const map = [
      { badge: "bg-slate-100 text-slate-600",   label: "None" },
      { badge: "bg-sky-100 text-sky-700",        label: "Low" },
      { badge: "bg-amber-100 text-amber-700",    label: "Medium" },
      { badge: "bg-orange-100 text-orange-700",  label: "High" },
      { badge: "bg-red-100 text-red-700",        label: "Urgent" },
      { badge: "bg-red-200 text-red-800 font-bold", label: "Critical" },
    ];
    return map[priority] || map[0];
  }

  function getKpiLatestValue(kpi) {
    if (!kpi.entries?.length) return null;
    const sorted = [...kpi.entries].sort(
      (a, b) => new Date(b.period_start) - new Date(a.period_start)
    );
    return sorted[0].value;
  }

  function stripHtml(html) {
    if (!html) return "";
    return html.replace(/<[^>]*>/g, "").trim();
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">
        Loading project...
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!project) {
    return (
      <div className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">
        Project not found.
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex items-start gap-4">
          <div className="group relative shrink-0">
            <label
              htmlFor="project-logo-input"
              className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-teal-500 text-lg font-bold text-white shadow-sm ${
                canManageProjects ? "cursor-pointer" : ""
              }`}
              title={canManageProjects ? "Change project logo" : undefined}
            >
              {project.logo_url ? (
                <img
                  src={resolveMediaUrl(project.logo_url)}
                  alt={`${project.name} logo`}
                  className="h-full w-full object-cover"
                />
              ) : (
                getProjectInitials(project.name)
              )}

              {canManageProjects && (
                <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-950/0 text-transparent transition-colors group-hover:bg-slate-950/50 group-hover:text-white">
                  {isUploadingLogo ? (
                    <span className="text-[10px] font-semibold">Uploading…</span>
                  ) : (
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 5.5A1.5 1.5 0 013.5 4h2.379a1.5 1.5 0 001.06-.44l.122-.12A2.5 2.5 0 018.939 3h2.122a2.5 2.5 0 011.878.44l.122.12a1.5 1.5 0 001.06.44H16.5A1.5 1.5 0 0118 5.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 012 14.5v-9zM10 7a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" />
                    </svg>
                  )}
                </span>
              )}
            </label>
            {canManageProjects && (
              <input
                id="project-logo-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleLogoFileChange}
                disabled={isUploadingLogo}
                className="hidden"
              />
            )}
            {canManageProjects && project.logo_url && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                disabled={isUploadingLogo}
                title="Remove logo"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm hover:text-red-600"
              >
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold text-slate-900">
                {project.name}
              </h1>

              <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${getProjectStatusBadge(project.status)}`}>
                {project.status}
              </span>
            </div>

            <p className="mt-2 text-sm text-slate-600">
              {project.description || "No description added."}
            </p>
          </div>
        </div>

        {canCreateTasks ? (
          <div className="flex w-fit gap-2">
            <button
              type="button"
              onClick={() => setIsInviteClientModalOpen(true)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Start Client Onboarding
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              + Add Task
            </button>
          </div>
        ) : null}
      </div>

      <div className="mb-6 border-b border-slate-200">
        <nav className="flex gap-6 overflow-x-auto">
          {(canCreateTasks
            ? ["overview", "list", "board", "calendar", "reports", "task requests"]
            : ["overview", "list", "board", "calendar", "reports"]
          ).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setActiveTab(tab);
                setOpenActionMenuId(null);
              }}
              className={
                activeTab === tab
                  ? "whitespace-nowrap border-b-2 border-slate-900 pb-3 text-sm font-semibold capitalize text-slate-900"
                  : "whitespace-nowrap pb-3 text-sm font-semibold capitalize text-slate-500 hover:text-slate-900"
              }
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <main>
        {activeTab === "overview" ? (
          <section className="space-y-8">

            {/* ── Top stats ── */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-500">Working Time</p>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
                    <svg className="h-4 w-4 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .27.144.518.378.653l3.5 2a.75.75 0 00.744-1.302L10.75 9.585V5z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
                <p className={workingTimeSummary?.active_timer_count > 0 ? "mt-3 font-mono text-3xl font-bold text-slate-900" : "mt-3 text-3xl font-bold text-slate-900"}>
                  {workingTimeSummary?.active_timer_count > 0
                    ? formatLiveDurationSeconds(displayWorkingTimeSeconds)
                    : formatDurationSeconds(displayWorkingTimeSeconds)}
                </p>
                {workingTimeSummary?.active_timer_count > 0 && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                    {workingTimeSummary.active_timer_count} timer{workingTimeSummary.active_timer_count === 1 ? "" : "s"} running
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-500">Total Tasks</p>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                    <svg className="h-4 w-4 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                      <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
                <p className="mt-3 text-3xl font-bold text-slate-900">{tasks.length}</p>
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-slate-300" />
                    {todoTaskCount} todo
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-blue-400" />
                    {inProgressTaskCount} active
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    {doneTaskCount} done
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-500">Rocks</p>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
                    <svg className="h-4 w-4 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
                <p className="mt-3 text-3xl font-bold text-slate-900">{rocks.length}</p>
                {rocks.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    {rocks.filter(r => r.status === "complete").length} complete ·{" "}
                    {rocks.filter(r => r.status === "on_track").length} on track
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-500">KPIs & Issues</p>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50">
                    <svg className="h-4 w-4 text-teal-600" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                    </svg>
                  </div>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <div>
                    <p className="text-3xl font-bold text-slate-900">{kpis.length}</p>
                    <p className="text-xs text-slate-500">KPIs</p>
                  </div>
                  <div className="mb-1 h-8 w-px bg-slate-200" />
                  <div>
                    <p className="text-3xl font-bold text-slate-900">{issues.length}</p>
                    <p className="text-xs text-slate-500">Issues</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Task completion progress ── */}
            {tasks.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">Task Progress</h2>
                  <span className="text-sm font-medium text-slate-500">
                    {doneTaskCount} / {tasks.length} done
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-500"
                    style={{ width: `${Math.round((doneTaskCount / tasks.length) * 100)}%` }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-slate-300" />
                    {todoTaskCount} Todo
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-400" />
                    {inProgressTaskCount} In Progress
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    {doneTaskCount} Done
                  </span>
                </div>
              </div>
            )}

            {/* ── Teams ── */}
            <div>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Teams</h2>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                  {projectTeams.length}
                </span>
              </div>

              {projectTeams.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
                  <svg className="mb-3 h-8 w-8 text-slate-300" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M7 8a3 3 0 100-6 3 3 0 000 6zM13.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                    <path d="M2.5 15.5A4.5 4.5 0 017 11h.25a4.5 4.5 0 014.5 4.5.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5zM14 16h3.5a.5.5 0 00.5-.5 3.5 3.5 0 00-5.437-2.917A5.98 5.98 0 0114 16z" />
                  </svg>
                  <p className="text-sm font-medium text-slate-500">No teams are working on this project yet.</p>
                  <p className="mt-1 text-xs text-slate-400">Teams appear here once their Rocks, KPIs, or tasks are linked to this project.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {projectTeams.map((team) => (
                    <div key={team.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{team.name}</h3>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                          {team.members?.length || 0} member{(team.members?.length || 0) === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(team.members || []).map((member) => (
                          <span key={member.id}
                            className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[9px] font-bold text-white">
                              {(member.full_name || member.email || "?").charAt(0).toUpperCase()}
                            </span>
                            {member.full_name || member.email}
                          </span>
                        ))}
                        {(team.members || []).length === 0 && (
                          <span className="text-xs italic text-slate-400">No members assigned</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Objectives → Rocks → KPIs ── */}
            <div>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Objectives</h2>
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                  {objectives.length}
                </span>
              </div>

              {objectives.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
                  <svg className="mb-3 h-8 w-8 text-slate-300" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12zm0-2a4 4 0 100-8 4 4 0 000 8zm0-2a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm font-medium text-slate-500">No objectives linked to this project.</p>
                  <p className="mt-1 text-xs text-slate-400">Link an objective to this project from Organization → Objectives.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {objectives.map((objective) => {
                    const objCfg = getObjectiveStatusCfg(objective.status);
                    const objRocks = allProjectRocks.filter((r) => r.objective_id === objective.id);
                    return (
                      <div key={objective.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        {/* Objective header */}
                        <div className="flex flex-wrap items-center gap-2">
                          <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12zm0-2a4 4 0 100-8 4 4 0 000 8zm0-2a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                          </svg>
                          <h3 className="text-sm font-semibold text-slate-900">{objective.title}</h3>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${objCfg.badge}`}>{objCfg.label}</span>
                          <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                            {objective.owner && (
                              <span className="flex items-center gap-1">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                                  {objective.owner.full_name?.charAt(0) || "?"}
                                </span>
                                {objective.owner.full_name}
                              </span>
                            )}
                            {objective.due_date && <span>{formatDate(objective.due_date)}</span>}
                          </span>
                        </div>

                        {/* Rocks under this objective */}
                        {objRocks.length === 0 ? (
                          <p className="mt-3 pl-6 text-xs italic text-slate-400">No Rocks linked to this objective.</p>
                        ) : (
                          <div className="mt-3 space-y-2 pl-6">
                            {objRocks.map((rock) => {
                              const rockCfg = getRockStatusCfg(rock.status);
                              const trackingKpis = allProjectKpis.filter((k) => k.rock_id === rock.id);
                              return (
                                <div key={rock.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <svg className="h-3.5 w-3.5 shrink-0 text-purple-500" viewBox="0 0 20 20" fill="currentColor">
                                      <path d="M10 2L3 7l2.5 11h9L17 7l-7-5z" />
                                    </svg>
                                    <span className="text-sm font-medium text-slate-800">{rock.title}</span>
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${rockCfg.badge}`}>
                                      {rockCfg.label}
                                    </span>
                                    <span className="ml-auto text-xs text-slate-400">
                                      {rock.owner ? rock.owner.full_name : "No owner"}
                                    </span>
                                  </div>
                                  {/* KPIs tracking this Rock */}
                                  {trackingKpis.length === 0 ? (
                                    <p className="mt-2 pl-5 text-xs italic text-slate-400">No KPIs tracking this Rock.</p>
                                  ) : (
                                    <div className="mt-2 space-y-1 pl-5">
                                      {trackingKpis.map((kpi) => {
                                        const latest = getKpiLatestValue(kpi);
                                        return (
                                          <div key={kpi.id} className="flex flex-wrap items-center gap-2 text-xs">
                                            <svg className="h-3 w-3 shrink-0 text-teal-600" viewBox="0 0 20 20" fill="currentColor">
                                              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                                            </svg>
                                            <span className="font-medium text-slate-700">{kpi.title}</span>
                                            <span className="text-slate-400">
                                              Latest: {latest !== null && latest !== undefined ? latest.toLocaleString() : "—"}
                                              {kpi.reference_value !== null && kpi.reference_value !== undefined
                                                ? ` · Target: ${kpi.reference_value.toLocaleString()}`
                                                : ""}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Rocks ── */}
            <div>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Rocks</h2>
                <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
                  {rocks.length}
                </span>
              </div>

              {rocks.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
                  <svg className="mb-3 h-8 w-8 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm font-medium text-slate-500">No rocks assigned to this project.</p>
                  <p className="mt-1 text-xs text-slate-400">Assign a rock to this project from the team's Rocks tab.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {rocks.map((rock) => {
                    const cfg = getRockStatusCfg(rock.status);
                    const total = rock.milestones?.length || 0;
                    const done = rock.milestones?.filter(m => m.status === "complete").length || 0;
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    return (
                      <div key={rock.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{rock.title}</h3>
                          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cfg.badge}`}>
                            {cfg.label}
                          </span>
                        </div>

                        {rock.description ? (
                          <p className="mb-3 line-clamp-2 text-xs text-slate-500">{stripHtml(rock.description)}</p>
                        ) : null}

                        <div className="mt-auto space-y-3">
                          {total > 0 && (
                            <div>
                              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                                <span>Milestones</span>
                                <span>{done}/{total}</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-teal-500"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>
                              {rock.owner ? (
                                <span className="flex items-center gap-1">
                                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                                    {rock.owner.full_name?.charAt(0) || "?"}
                                  </span>
                                  {rock.owner.full_name}
                                </span>
                              ) : (
                                <span className="text-slate-400">No owner</span>
                              )}
                            </span>
                            {rock.due_date ? (
                              <span>{formatDate(rock.due_date)}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── KPIs ── */}
            <div>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Key Performance Indicators</h2>
                <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700">
                  {kpis.length}
                </span>
              </div>

              {kpis.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
                  <svg className="mb-3 h-8 w-8 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                  <p className="text-sm font-medium text-slate-500">No KPIs assigned to this project.</p>
                  <p className="mt-1 text-xs text-slate-400">Assign a KPI to this project from the team's KPIs tab.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {kpis.map((kpi) => {
                    const latestVal = getKpiLatestValue(kpi);
                    return (
                      <div key={kpi.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{kpi.title}</h3>
                          {kpi.kpi_group ? (
                            <span className="shrink-0 rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-700">
                              {kpi.kpi_group}
                            </span>
                          ) : null}
                        </div>

                        {kpi.description ? (
                          <p className="mb-3 line-clamp-2 text-xs text-slate-500">{stripHtml(kpi.description)}</p>
                        ) : null}

                        <div className="mt-auto space-y-3">
                          <div className="flex items-center gap-4">
                            <div>
                              <p className="text-xs text-slate-400">Latest value</p>
                              <p className="text-xl font-bold text-slate-900">
                                {latestVal !== null && latestVal !== undefined
                                  ? latestVal.toLocaleString()
                                  : <span className="text-sm text-slate-400">—</span>}
                              </p>
                            </div>
                            {kpi.reference_value !== null && kpi.reference_value !== undefined && (
                              <div>
                                <p className="text-xs text-slate-400">Target</p>
                                <p className="text-xl font-bold text-slate-600">{kpi.reference_value.toLocaleString()}</p>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between text-xs text-slate-500">
                            {kpi.owner ? (
                              <span className="flex items-center gap-1">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-[10px] font-bold text-teal-700">
                                  {kpi.owner.full_name?.charAt(0) || "?"}
                                </span>
                                {kpi.owner.full_name}
                              </span>
                            ) : (
                              <span className="text-slate-400">No owner</span>
                            )}
                            <span className="capitalize text-slate-400">{kpi.target_type}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Issues ── */}
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">Issues</h2>
                  <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                    {issues.length}
                  </span>
                </div>
                {canCreateTasks && (
                  <button type="button" onClick={openIssueModal}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                    </svg>
                    Create Issue
                  </button>
                )}
              </div>

              {issues.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
                  <svg className="mb-3 h-8 w-8 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm font-medium text-slate-500">No issues linked to this project.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {canCreateTasks ? 'Click "Create Issue" to report the first one.' : "No issues have been reported for this project yet."}
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="divide-y divide-slate-100">
                    {issues.map((issue) => {
                      const priorityCfg = getIssuePriorityCfg(issue.priority);
                      const preview = stripHtml(issue.description);
                      return (
                        <div key={issue.id} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50">
                          <div className="mt-0.5 shrink-0">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${priorityCfg.badge}`}>
                              {priorityCfg.label}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-900">{issue.title}</p>
                            {preview ? (
                              <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{preview}</p>
                            ) : null}
                          </div>
                          <div className="shrink-0 text-right">
                            {issue.assignee ? (
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                                  {issue.assignee.full_name?.charAt(0) || "?"}
                                </span>
                                {issue.assignee.full_name}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">Unassigned</span>
                            )}
                            <p className="mt-1 text-xs text-slate-400">
                              {new Date(issue.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Client invitations (staff only) ── */}
            {canCreateTasks ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-semibold text-slate-900">Client Invitations</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Invited clients can view this project's status and submit task requests once they accept.
                </p>
                <div className="mt-4">
                  <InvitationsTable
                    invitations={clientInvitations}
                    isLoading={isLoadingClientInvitations}
                    showProject={false}
                    onResend={handleResendClientInvitation}
                    onRevoke={handleRevokeClientInvitation}
                    onDeleteDraft={handleDeleteDraftInvitation}
                    onRemove={handleRemoveInvitation}
                  />
                </div>
              </div>
            ) : null}

          </section>
        ) : null}

        {activeTab === "list" ? (
          <section className="overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto xl:overflow-visible">
              <table className="w-full min-w-[1120px] text-sm xl:min-w-0">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className="w-12 px-4 py-3 text-left font-semibold text-slate-700" />

                    <th className="min-w-72 px-4 py-3 text-left font-semibold text-slate-700">
                      Task Name
                    </th>

                    <th className="min-w-32 px-4 py-3 text-left font-semibold text-slate-700">
                      Priority
                    </th>

                    <th className="min-w-44 px-4 py-3 text-left font-semibold text-slate-700">
                      Assignee
                    </th>

                    <th className="min-w-44 px-4 py-3 text-left font-semibold text-slate-700">
                      Team
                    </th>

                    <th className="min-w-32 px-4 py-3 text-left font-semibold text-slate-700">
                      Start Date
                    </th>

                    <th className="min-w-32 px-4 py-3 text-left font-semibold text-slate-700">
                      Due Date
                    </th>

                    <th className="min-w-40 px-4 py-3 text-left font-semibold text-slate-700">
                      Status
                    </th>

                    <th className="min-w-36 px-4 py-3 text-left font-semibold text-slate-700">
                      Working Time
                    </th>

                    {canManageTasks ? (
                      <th className="w-16 px-4 py-3 text-right font-semibold text-slate-700">
                        Actions
                      </th>
                    ) : null}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {tasks.length ? (
                    tasks.map((task) => (
                      <tr key={task.id} className={getDueRowClassName(task)}>
                        <td className="px-4 py-4 align-middle">
                          <button
                            type="button"
                            onClick={() =>
                              quickStatusUpdate(
                                task,
                                task.status === "done" ? "todo" : "done"
                              )
                            }
                            className={
                              task.status === "done"
                                ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs text-white"
                                : "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-400 text-xs text-slate-400 hover:border-slate-900 hover:text-slate-900"
                            }
                            title={
                              task.status === "done"
                                ? "Mark as Todo"
                                : "Mark as Done"
                            }
                          >
                            ✓
                          </button>
                        </td>

                        <td className="px-4 py-4 align-middle">
                          <span
                            className={
                              task.status === "done"
                                ? "font-medium text-slate-500 line-through"
                                : "font-medium text-slate-900"
                            }
                          >
                            {task.name}
                          </span>
                        </td>

                        <td className="px-4 py-4 align-middle">
                          {canManageTasks ? (
                            <Select
                              value={task.priority || "medium"}
                              onChange={(event) => quickPriorityUpdate(task, event.target.value)}
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold capitalize text-slate-700 focus:border-slate-900 focus:outline-none"
                            >
                              {PRIORITY_OPTIONS.map((p) => (
                                <option key={p.value} value={p.value}>{p.label}</option>
                              ))}
                            </Select>
                          ) : (
                            <span className="capitalize text-slate-700">{task.priority || "medium"}</span>
                          )}
                        </td>

                        <td className="px-4 py-4 align-middle text-slate-700">
                          {canManageTasks ? (() => {
                            // Inline-assignee-dropdown bug-fix follow-up:
                            // Team eligibility wins whenever this Task
                            // belongs to a Team — sourced from the bulk
                            // lookup fetched once for every distinct
                            // team_id on this project's task table, never
                            // a per-row fetch.
                            const resolvedOptions = getInlineAssigneeOptions(task, { assignableUsersByTeamId, orgWideUsers: assignees });
                            const stillLoadingThisTeam = task.team_id != null && resolvedOptions === undefined && assignableUsersLoading;
                            const options = resolvedOptions ?? [];
                            if (stillLoadingThisTeam) {
                              return (
                                <Select value="" disabled
                                  className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-400">
                                  <option value="">Loading members…</option>
                                </Select>
                              );
                            }
                            return (
                              <Select
                                value={task.assignee_id || ""}
                                onChange={(event) => quickAssigneeUpdate(task, event.target.value)}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-slate-900 focus:outline-none"
                              >
                                <option value="">Unassigned</option>
                                {options.map((assignee) => (
                                  <option key={assignee.id} value={assignee.id}>{assignee.full_name}</option>
                                ))}
                              </Select>
                            );
                          })() : (
                            task.assignee?.full_name || "—"
                          )}
                        </td>

                        <td className="px-4 py-4 align-middle text-slate-700">
                          {task.team?.name || "—"}
                        </td>

                        <td className="px-4 py-4 align-middle text-slate-700">
                          {formatDate(task.start_date) || "—"}
                        </td>

                        <td className="px-4 py-4 align-middle text-slate-700">
                          {formatDate(task.due_date) || "—"}
                        </td>

                        <td className="px-4 py-4 align-middle">
                          {canManageTasks ? (
                            <Select
                              value={task.status}
                              onChange={(event) =>
                                quickStatusUpdate(task, event.target.value)
                              }
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none"
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option
                                  key={status.value}
                                  value={status.value}
                                >
                                  {status.label}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <span className={getStatusBadgeClass(task.status)}>
                              {getStatusLabel(task.status)}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-4 align-middle">
                          <WorkingTimeCell
                            taskId={task.id}
                            workingTimeSeconds={taskWorkingTimes[task.id]?.working_time_seconds}
                            activeTimerCount={taskWorkingTimes[task.id]?.active_timer_count}
                            currentUserIsActive={Boolean(taskWorkingTimes[task.id]?.current_user_is_active)}
                            currentUserHasActiveTimerElsewhere={currentUserHasActiveTimer && !taskWorkingTimes[task.id]?.current_user_is_active}
                            canControlTimer={task.assignee_id != null && task.assignee_id === user?.id}
                            onTimeChange={() => { refreshTaskWorkingTimes(); loadWorkingTime(); }}
                          />
                        </td>

                        {canManageTasks ? (
                          <td className="relative px-4 py-4 text-right align-middle">
                            <button
                              type="button"
                              onClick={() => toggleActionMenu(task.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                              title="Task actions"
                            >
                              <ThreeDotsIcon />
                            </button>

                            {openActionMenuId === task.id ? (
                              <div className="absolute right-4 top-12 z-20 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    handleEdit(task);
                                  }}
                                  className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Edit
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    handleDelete(task);
                                  }}
                                  className="block w-full px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={canManageTasks ? 10 : 9}
                        className="px-4 py-8 text-center text-sm text-slate-500"
                      >
                        No tasks found in this project.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "board" ? (
          <section className="grid gap-4 md:grid-cols-3">
            {STATUS_OPTIONS.map((status) => (
              <div
                key={status.value}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <h2 className="mb-4 text-sm font-semibold text-slate-700">
                  {status.label}
                  <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                    {groupedByStatus[status.value]?.length || 0}
                  </span>
                </h2>

                <div className="space-y-3">
                  {groupedByStatus[status.value]?.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <h3 className="font-medium text-slate-900">
                        {task.name}
                      </h3>

                      <p className="mt-2 text-xs text-slate-500">
                        Assignee: {task.assignee?.full_name || "No assignee"}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        Team: {task.team?.name || "No team"}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        Start: {formatDate(task.start_date) || "—"}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        Due: {formatDate(task.due_date) || "—"}
                      </p>

                      <div className="mt-3">
                        <label className="mb-1 block text-xs font-medium text-slate-500">
                          Status
                        </label>

                        <Select
                          value={task.status}
                          onChange={(event) =>
                            quickStatusUpdate(task, event.target.value)
                          }
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                        >
                          {STATUS_OPTIONS.map((statusOption) => (
                            <option
                              key={statusOption.value}
                              value={statusOption.value}
                            >
                              {statusOption.label}
                            </option>
                          ))}
                        </Select>
                      </div>

                      {canManageTasks ? (
                        <div className="mt-4 flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(task)}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDelete(task)}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}

                  {!groupedByStatus[status.value]?.length ? (
                    <p className="rounded-xl bg-white px-4 py-5 text-sm text-slate-500">
                      No tasks
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {activeTab === "calendar" ? (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goToPreviousMonth}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  ‹
                </button>

                <button
                  type="button"
                  onClick={goToToday}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Today
                </button>

                <button
                  type="button"
                  onClick={goToNextMonth}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  ›
                </button>
              </div>

              <h2 className="text-lg font-semibold text-slate-900">
                {calendarDate.toLocaleString("default", {
                  month: "long",
                  year: "numeric",
                })}
              </h2>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                <div className="grid grid-cols-7 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (day) => (
                      <div
                        key={day}
                        className="border-r border-slate-200 p-3"
                      >
                        {day}
                      </div>
                    )
                  )}
                </div>

                <div className="grid grid-cols-7">
                  {calendarDays.map((day) => {
                    const dateKey = toDateInputValue(day);
                    const dayTasks = tasksByDueDate[dateKey] || [];
                    const isCurrentMonth =
                      day.getMonth() === calendarDate.getMonth();

                    return (
                      <div
                        key={dateKey}
                        className={
                          isCurrentMonth
                            ? "min-h-32 border-r border-b border-slate-200 p-2"
                            : "min-h-32 border-r border-b border-slate-200 bg-slate-50 p-2 text-slate-400"
                        }
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-semibold">
                            {day.getDate()}
                          </span>

                          {dayTasks.length ? (
                            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                              {dayTasks.length}
                            </span>
                          ) : null}
                        </div>

                        <div className="space-y-1">
                          {dayTasks.slice(0, 3).map((task) => (
                            <button
                              key={task.id}
                              type="button"
                              onClick={() => canManageTasks && handleEdit(task)}
                              className="block w-full truncate rounded bg-teal-100 px-2 py-1 text-left text-xs font-medium text-teal-900"
                              title={task.name}
                            >
                              {task.name}
                            </button>
                          ))}

                          {dayTasks.length > 3 ? (
                            <p className="text-xs text-slate-500">
                              +{dayTasks.length - 3} more
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "reports" ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Project Reports</h2>
              {canManageTasks ? (
                <button
                  type="button"
                  onClick={openCreateReportModal}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Create Report
                </button>
              ) : null}
            </div>

            {isLoadingReports ? (
              <p className="text-sm text-slate-500">Loading reports...</p>
            ) : reports.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                No reports yet for this project.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {reports.map((report) => (
                  <li key={report.id} className="flex items-center justify-between py-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => navigate(`/reports/${report.id}/edit`)}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {report.title}
                      </button>
                      <p className="text-xs text-slate-500 capitalize">
                        {report.report_type} · {report.status} · v{report.version}
                      </p>
                    </div>
                    {canManageTasks && report.status === "draft" ? (
                      <button
                        type="button"
                        onClick={() => handleDeleteReport(report)}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {activeTab === "task requests" ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Task Requests</h2>

            {isLoadingTaskRequests ? (
              <p className="text-sm text-slate-500">Loading task requests...</p>
            ) : taskRequests.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                No task requests submitted by clients yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {taskRequests.map((request) => (
                  <li key={request.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900">{request.title}</p>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${TASK_REQUEST_STATUS_BADGE[request.status] || TASK_REQUEST_STATUS_BADGE.pending}`}>
                          {request.status}
                        </span>
                      </div>
                      {request.description ? (
                        <p className="mt-1 text-sm text-slate-500">{request.description}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-slate-400">
                        Submitted by {request.submitted_by?.full_name || "a client"} · {new Date(request.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    {request.status === "pending" ? (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => openConvertModal(request)}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                        >
                          Convert to Task
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectRequest(request)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </main>

      {canCreateTasks && isTaskModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {isEditing ? "Edit Task" : "Create Task"}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  This task will be created under{" "}
                  <span className="font-medium text-slate-700">
                    {project.name}
                  </span>
                  .
                </p>
              </div>

              <button
                type="button"
                onClick={closeTaskModal}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                ✕
              </button>
            </div>

            {error ? (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Task name
                </label>

                <input
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Description
                </label>

                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={4}
                  placeholder="Add task details..."
                  className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400"
                />
              </div>

              {/* Time tracking only applies to a task that already exists —
                  nothing to start a timer on until Create Task is saved. */}
              {isEditing && (
                <TaskTimeTracker
                  taskId={editingTaskId}
                  onTimeChange={() => {
                    loadWorkingTime();
                    refreshTaskWorkingTimes();
                  }}
                />
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Start date
                  </label>

                  <DatePicker name="start_date" value={formData.start_date} onChange={handleChange} />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Due date
                  </label>

                  <DatePicker name="due_date" value={formData.due_date} onChange={handleChange} />
                </div>
              </div>

              {/* Assignee is set later, on edit — new tasks are created
                  unassigned so they land in the team's To-Do list. */}
              {isEditing && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Assignee
                  </label>

                  <Select
                    name="assignee_id"
                    value={formData.assignee_id}
                    onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select assignee</option>

                    {modalAssignees.map((assignee) => (
                      <option key={assignee.id} value={assignee.id}>
                        {assignee.role ? `${assignee.full_name} — ${assignee.role}` : assignee.full_name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Team
                </label>

                <Select
                  name="team_id"
                  value={formData.team_id}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select team</option>

                  {assignableTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>

                {!assignableTeams.length ? (
                  <p className="mt-1 text-xs text-slate-400">
                    {canCreateTasks && !canManageTasks
                      ? "No teams are working on this project yet — ask a manager to assign one."
                      : "No teams yet — you can assign one later from the Teams page."}
                  </p>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Status
                </label>

                <Select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeTaskModal}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting
                    ? "Saving..."
                    : isEditing
                    ? "Update Task"
                    : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {canCreateTasks && isIssueModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Create Issue</h2>
                <p className="mt-1 text-sm text-slate-500">Report a problem for {project.name} and assign it to a team.</p>
              </div>
              <button type="button" onClick={closeIssueModal}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            {issueError && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{issueError}</div>
            )}

            <form onSubmit={handleIssueSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Title *</label>
                <input name="title" value={issueForm.title} onChange={handleIssueChange} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
                <textarea name="description" value={issueForm.description} onChange={handleIssueChange} rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Team *</label>
                  <Select name="team_id" value={issueForm.team_id} onChange={handleIssueChange} required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Select team</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Priority</label>
                  <Select name="priority" value={issueForm.priority} onChange={handleIssueChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {ISSUE_PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeIssueModal}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmittingIssue}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {isSubmittingIssue ? "Saving…" : "Create Issue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isReportModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Create Report</h2>
                <p className="mt-1 text-sm text-slate-500">
                  This report will be created under <span className="font-medium text-slate-700">{project.name}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReportModalOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateReport} className="space-y-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Report Type</label>
                <Select
                  name="report_type"
                  value={reportForm.report_type}
                  onChange={handleReportFormChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="weekly">Weekly Project Report</option>
                  <option value="monthly">Monthly Project Report</option>
                  <option value="client">Client Project Report</option>
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Report Title</label>
                <input
                  name="title"
                  value={reportForm.title}
                  onChange={handleReportFormChange}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Period Start</label>
                  <DatePicker name="period_start" value={reportForm.period_start} onChange={handleReportFormChange} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Period End</label>
                  <DatePicker name="period_end" value={reportForm.period_end} onChange={handleReportFormChange} />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReportModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingReport}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {isCreatingReport ? "Creating..." : "Create Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <StartOnboardingModal
        isOpen={isInviteClientModalOpen}
        onClose={() => setIsInviteClientModalOpen(false)}
        onCreated={loadClientInvitations}
        lockedProjectId={projectId}
      />

      {convertingRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Convert to Task</h2>
                <p className="mt-1 text-sm text-slate-500">
                  "{convertingRequest.title}" will become a task under{" "}
                  <span className="font-medium text-slate-700">{project.name}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConvertingRequest(null)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConvertRequest} className="space-y-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Team</label>
                <Select
                  name="team_id"
                  value={convertForm.team_id}
                  onChange={handleConvertFormChange}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Assignee (optional)</label>
                <Select
                  name="assignee_id"
                  value={convertForm.assignee_id}
                  onChange={handleConvertFormChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {convertTeamAssignableUsers.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.role ? `${assignee.full_name} — ${assignee.role}` : assignee.full_name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Priority</label>
                  <Select
                    name="priority"
                    value={convertForm.priority}
                    onChange={handleConvertFormChange}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Due date</label>
                  <DatePicker name="due_date" value={convertForm.due_date} onChange={handleConvertFormChange} />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConvertingRequest(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isConvertingRequest || !teams.length}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {isConvertingRequest ? "Converting..." : "Convert to Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}