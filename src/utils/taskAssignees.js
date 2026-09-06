// Shared Task-assignee eligibility helper (Task Assignee bug-fix
// follow-up) — one implementation instead of separate, drifting filters
// duplicated across TasksPage/ProjectDetailPage/TeamDetailPage/
// CreateTodoModal. This is UX filtering only; the backend
// (app.core.task_assignment.validate_task_assignee) is the actual
// security boundary and re-enforces the same rules on every
// create/update request regardless of what the frontend shows.
//
// Rule A: a Client must never appear as a Task-assignee option, no
// matter who is viewing the dropdown (Owner/Admin/Team Manager/Project
// Manager) or which surface it's on.
//
// Rule B/C/F: if the Task belongs to a Team, eligible assignees are
// exactly that Team's members (see getAssignableUsersForTeam / the
// `GET /teams/{id}/assignable-users` endpoint, which already excludes
// Clients and inactive members server-side) — never the whole
// organization, and never widened by Admin/Owner privilege. If the Task
// has no team, this falls back to the existing org-wide eligible-role
// list (still excluding Client).

// Existing app-wide convention (already used, verbatim, by TasksPage and
// ProjectDetailPage before this fix) for "who can be assigned a Task
// when there's no Team to scope the choice to" — Client is deliberately
// absent from this list.
export const ORG_WIDE_ASSIGNABLE_ROLES = ["owner", "admin", "team_manager", "team_member"];

// Rule F fallback: filters a plain organization user list (e.g. from
// GET /users) down to eligible assignees when a Task has no team_id.
// `role` here must be the organization-scoped role (as GET /users
// already returns — see app/api/routes/users.py's list_users), never a
// per-user default/legacy value.
export function filterOrgAssignableUsers(users) {
  return (users || []).filter((u) => ORG_WIDE_ASSIGNABLE_ROLES.includes(u.role));
}

// Inline-assignee-dropdown bug-fix follow-up: the single function every
// inline quick-assignee `<Select>` (TasksPage's "All Tasks" table,
// ProjectDetailPage's task table, ...) should call to get its option
// list — one implementation instead of each surface re-deriving the same
// "team wins, org-wide-minus-Client otherwise" precedence separately.
//
// `assignableUsersByTeamId` is expected to be populated from the bulk
// `POST /teams/assignable-users/bulk` endpoint (see teamApi.js), keyed by
// team id as a STRING (JSON object keys are always strings) — never
// fetched per-row; the caller fetches it once for every distinct
// team_id among its currently-visible tasks and passes the same object
// to every row.
export function getInlineAssigneeOptions(task, { assignableUsersByTeamId, orgWideUsers }) {
  if (task?.team_id != null) {
    // Team eligibility wins whenever a Task belongs to a Team (Rule B/C)
    // — never the org-wide list, regardless of viewer privilege. If the
    // bulk lookup hasn't resolved this team yet (or the caller has no
    // access to it), this is `undefined` — treated as "no options yet"
    // by the caller (see PHASE 11's loading/empty-state distinction),
    // never silently falling back to the org-wide list.
    return assignableUsersByTeamId?.[String(task.team_id)];
  }
  // Rule F: no Team on this Task — existing org-wide-minus-Client
  // fallback, unchanged.
  return filterOrgAssignableUsers(orgWideUsers);
}
