import { apiClient } from "./client";

// "Save Meeting Template" (plan section 17, MVP scope) — org-scoped, reusable
// agenda structures. list() also seeds the 9 prebuilt meeting-type templates
// (plan section 5) the first time an org has none, server-side.
export const meetingTemplateApi = {
  list() {
    return apiClient.get(`/meeting-templates`);
  },
  create(payload) {
    return apiClient.post(`/meeting-templates`, payload);
  },
  delete(templateId) {
    return apiClient.delete(`/meeting-templates/${templateId}`);
  },
};
