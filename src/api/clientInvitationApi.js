import { apiClient } from "./client";

export const clientInvitationApi = {
  list(projectId) {
    const query = projectId ? `?project_id=${projectId}` : "";
    return apiClient.get(`/client-invitations${query}`);
  },
  invite(payload) {
    return apiClient.post("/client-invitations", payload);
  },
  resend(invitationId) {
    return apiClient.post(`/client-invitations/${invitationId}/resend`);
  },
  revoke(invitationId) {
    return apiClient.post(`/client-invitations/${invitationId}/revoke`);
  },
  deleteDraft(invitationId) {
    return apiClient.delete(`/client-invitations/${invitationId}`);
  },
};
