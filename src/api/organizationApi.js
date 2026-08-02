import { apiClient } from "./client";

export const organizationApi = {
  // Current organization profile
  getCurrent() {
    return apiClient.get("/organizations/current");
  },
  updateCurrent(payload) {
    return apiClient.put("/organizations/current", payload);
  },
  uploadLogo(file) {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.upload("/organizations/current/logo", formData, "POST");
  },
  deleteLogo() {
    return apiClient.delete("/organizations/current/logo");
  },

  // Core Values
  listValues() {
    return apiClient.get("/organization/values");
  },
  createValue(payload) {
    return apiClient.post("/organization/values", payload);
  },
  updateValue(id, payload) {
    return apiClient.patch(`/organization/values/${id}`, payload);
  },
  deleteValue(id) {
    return apiClient.delete(`/organization/values/${id}`);
  },

  // Objectives
  listObjectives() {
    return apiClient.get("/organization/objectives");
  },
  listObjectiveRocks() {
    return apiClient.get("/organization/objective-rocks");
  },
  createObjective(payload) {
    return apiClient.post("/organization/objectives", payload);
  },
  updateObjective(id, payload) {
    return apiClient.patch(`/organization/objectives/${id}`, payload);
  },
  deleteObjective(id) {
    return apiClient.delete(`/organization/objectives/${id}`);
  },

  // Org Roles
  listRoles() {
    return apiClient.get("/organization/roles");
  },
  createRole(payload) {
    return apiClient.post("/organization/roles", payload);
  },
  updateRole(id, payload) {
    return apiClient.patch(`/organization/roles/${id}`, payload);
  },
  deleteRole(id) {
    return apiClient.delete(`/organization/roles/${id}`);
  },

  // Scoreboard scoring weights
  getScoreboardWeights() {
    return apiClient.get("/organizations/current/scoreboard-weights");
  },
  updateScoreboardWeights(payload) {
    return apiClient.put("/organizations/current/scoreboard-weights", payload);
  },
};
