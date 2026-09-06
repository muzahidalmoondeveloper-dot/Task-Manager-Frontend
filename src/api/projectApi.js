import { apiClient } from "./client";

export const projectApi = {
  list() {
    return apiClient.get("/projects");
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
};