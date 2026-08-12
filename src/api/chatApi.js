import { apiClient, getAccessToken } from "./client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const chatApi = {
  sendMessage(message, sessionId = null, pageContext = null) {
    // pageContext (architecture item 9 — validated UI/page context):
    // { page_type: "task"|"project"|"team"|"rock"|"issue"|"meeting"|"client_request"|"other", entity_id }
    // Lets deictic references ("mark this done") resolve to whatever record
    // the user is actually looking at. Optional — omit or pass null when
    // there's no specific record on screen (e.g. a list page).
    const body = { message, session_id: sessionId };
    if (pageContext) body.page_context = pageContext;
    return apiClient.post("/chat/message", body);
  },

  async uploadFile(file, message = "", sessionId = null) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("message", message);
    if (sessionId != null) {
      formData.append("session_id", String(sessionId));
    }

    const token = getAccessToken();
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${API_BASE_URL}/chat/upload`, {
      method: "POST",
      headers,
      body: formData,
    });

    let data = null;
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const raw = await response.text();
      data = raw ? JSON.parse(raw) : null;
    }

    if (!response.ok) {
      throw new Error(data?.detail || "File upload failed.");
    }

    return data;
  },

  listSessions() {
    return apiClient.get("/chat/sessions");
  },

  getSession(sessionId) {
    return apiClient.get(`/chat/sessions/${sessionId}`);
  },

  deleteSession(sessionId) {
    return apiClient.delete(`/chat/sessions/${sessionId}`);
  },

  confirmChangeSet(changeSetId) {
    return apiClient.post(`/chat/change-sets/${changeSetId}/confirm`);
  },

  cancelChangeSet(changeSetId) {
    return apiClient.post(`/chat/change-sets/${changeSetId}/cancel`);
  },

  undoOperation(operationId) {
    return apiClient.post(`/chat/operations/${operationId}/undo`);
  },

  listApprovals() {
    return apiClient.get("/chat/approvals");
  },

  approveRequest(approvalId) {
    return apiClient.post(`/chat/approvals/${approvalId}/approve`);
  },

  rejectRequest(approvalId) {
    return apiClient.post(`/chat/approvals/${approvalId}/reject`);
  },
};
