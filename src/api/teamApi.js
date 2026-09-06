import { apiClient } from "./client";

function buildQuery(params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return qs ? `?${qs}` : "";
}

export const teamApi = {
  list() {
    return apiClient.get("/teams");
  },

  getById(id) {
    return apiClient.get(`/teams/${id}`);
  },

  create(payload) {
    return apiClient.post("/teams", payload);
  },

  update(id, payload) {
    return apiClient.patch(`/teams/${id}`, payload);
  },

  delete(id) {
    return apiClient.delete(`/teams/${id}`);
  },

  getScoreboard(teamId, params = {}) {
    return apiClient.get(`/teams/${teamId}/scoreboard${buildQuery(params)}`);
  },

  getScoreboardTasks(teamId, params = {}) {
    return apiClient.get(`/teams/${teamId}/scoreboard/tasks${buildQuery(params)}`);
  },

  // Task Assignee bug-fix follow-up: the eligible Task-assignee set for
  // THIS exact team — ACTIVE members only, Client always excluded. Same
  // authorization as getById() (Owner/Admin: any team; anyone else: only
  // a team they manage or belong to) — never organization-wide `/users`,
  // so a Team Manager can load their own managed team's assignee options
  // without needing (and without being granted) org-wide Users access.
  getAssignableUsers(teamId) {
    return apiClient.get(`/teams/${teamId}/assignable-users`);
  },

  // Inline-assignee-dropdown bug-fix follow-up: the bulk counterpart to
  // getAssignableUsers() above — resolves eligible-assignee options for
  // however many DISTINCT teams a Task list's currently-visible rows
  // belong to in ONE request (never one request per task row, never one
  // per unique team either). Same authorization/eligibility rules as the
  // single-team endpoint, just computed in bulk. Returns
  // { teams: { [teamId]: [{ id, full_name, profile_picture_url }] } } —
  // a team_id the caller can't see is simply absent, not an error.
  getAssignableUsersBulk(teamIds) {
    if (!teamIds || teamIds.length === 0) {
      return Promise.resolve({ teams: {} });
    }
    return apiClient.post("/teams/assignable-users/bulk", { team_ids: teamIds });
  },
};