import { apiClient } from "./client";

export const projectApi = {
  list() {
    return apiClient.get("/projects");
  },

  // Team Manager Create-Task-form follow-up: GET /projects returns nothing
  // for a plain Team Manager (they have no direct Project-management
  // capability) — this is the scoped, additive source for Projects
  // reachable through a Team they actually manage (explicit Project<->Team
  // association), never organization-wide Project access. Safe to call for
  // any role; harmlessly returns [] for anyone who manages no Team.
  listForManagedTeams() {
    return apiClient.get("/projects/for-managed-teams");
  },

  getById(id) {
    return apiClient.get(`/projects/${id}`);
  },

  listItems(id) {
    return apiClient.get(`/projects/${id}/items`);
  },

  getWorkingTime(id) {
    return apiClient.get(`/projects/${id}/working-time`);
  },

  create(payload) {
    return apiClient.post("/projects", payload);
  },

  update(id, payload) {
    return apiClient.patch(`/projects/${id}`, payload);
  },

  delete(id) {
    return apiClient.delete(`/projects/${id}`);
  },

  uploadLogo(id, file) {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.upload(`/projects/${id}/logo`, formData, "POST");
  },

  deleteLogo(id) {
    return apiClient.delete(`/projects/${id}/logo`);
  },

  listMembers(id) {
    return apiClient.get(`/projects/${id}/members`);
  },

  addMember(id, userId) {
    return apiClient.post(`/projects/${id}/members`, { user_id: userId });
  },

  removeMember(id, userId) {
    return apiClient.delete(`/projects/${id}/members/${userId}`);
  },

  // Project Manager Team-selection bug-fix: explicit Project<->Team
  // assignment. listAssignableTeams() returns a deliberately minimal
  // {id, name, assigned} shape (never full team detail) — a plain
  // Project Manager has no other visibility into the org's teams at all,
  // so this is the one narrow surface that lets them see team NAMES to
  // attach to their own project.
  listAssignableTeams(id) {
    return apiClient.get(`/projects/${id}/teams/assignable`);
  },

  assignTeam(id, teamId) {
    return apiClient.post(`/projects/${id}/teams/${teamId}`);
  },

  unassignTeam(id, teamId) {
    return apiClient.delete(`/projects/${id}/teams/${teamId}`);
  },
};