import { apiClient } from "./client";

export const onboardingApi = {
  // Templates
  listTemplates() {
    return apiClient.get("/onboarding/templates");
  },
  getTemplate(id) {
    return apiClient.get(`/onboarding/templates/${id}`);
  },
  createTemplate(payload) {
    return apiClient.post("/onboarding/templates", payload);
  },
  updateTemplate(id, payload) {
    return apiClient.put(`/onboarding/templates/${id}`, payload);
  },
  deleteTemplate(id) {
    return apiClient.delete(`/onboarding/templates/${id}`);
  },
  duplicateTemplate(id) {
    return apiClient.post(`/onboarding/templates/${id}/duplicate`);
  },

  // Client onboardings
  list() {
    return apiClient.get("/client-onboardings");
  },
  get(id) {
    return apiClient.get(`/client-onboardings/${id}`);
  },
  create(payload) {
    return apiClient.post("/client-onboardings", payload);
  },
  update(id, payload) {
    return apiClient.put(`/client-onboardings/${id}`, payload);
  },
  start(id) {
    return apiClient.post(`/client-onboardings/${id}/start`);
  },
  remove(id) {
    return apiClient.delete(`/client-onboardings/${id}`);
  },

  // Steps
  listSteps(onboardingId) {
    return apiClient.get(`/client-onboardings/${onboardingId}/steps`);
  },
  updateStep(onboardingId, stepId, payload) {
    return apiClient.put(`/client-onboardings/${onboardingId}/steps/${stepId}`, payload);
  },

  // Step content — forms / questionnaires
  saveStepResponses(onboardingId, stepId, payload) {
    return apiClient.put(`/client-onboardings/${onboardingId}/steps/${stepId}/responses`, payload);
  },
  submitStep(onboardingId, stepId) {
    return apiClient.post(`/client-onboardings/${onboardingId}/steps/${stepId}/submit`);
  },

  // Step content — documents
  uploadStepDocument(onboardingId, stepId, file, requirementId) {
    const formData = new FormData();
    formData.append("file", file);
    if (requirementId != null) formData.append("requirement_id", requirementId);
    return apiClient.upload(`/client-onboardings/${onboardingId}/steps/${stepId}/documents`, formData);
  },
  reviewDocument(documentId, payload) {
    return apiClient.post(`/onboarding-documents/${documentId}/review`, payload);
  },

  // Review workflow
  approveStep(onboardingId, stepId, comment) {
    const query = comment ? `?comment=${encodeURIComponent(comment)}` : "";
    return apiClient.post(`/client-onboardings/${onboardingId}/steps/${stepId}/approve${query}`);
  },
  requestStepChanges(onboardingId, stepId, reason) {
    return apiClient.post(`/client-onboardings/${onboardingId}/steps/${stepId}/request-changes`, { reason });
  },
};
