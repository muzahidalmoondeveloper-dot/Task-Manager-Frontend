import { apiClient } from "./client";

export const meetingApi = {
  list(teamId, filter) {
    const qs = filter ? `?filter=${filter}` : "";
    return apiClient.get(`/teams/${teamId}/meetings${qs}`);
  },
  create(teamId, payload) {
    return apiClient.post(`/teams/${teamId}/meetings`, payload);
  },
  get(teamId, meetingId) {
    return apiClient.get(`/teams/${teamId}/meetings/${meetingId}`);
  },
  update(teamId, meetingId, payload) {
    return apiClient.patch(`/teams/${teamId}/meetings/${meetingId}`, payload);
  },
  delete(teamId, meetingId) {
    return apiClient.delete(`/teams/${teamId}/meetings/${meetingId}`);
  },

  // lifecycle
  start(teamId, meetingId) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/start`);
  },
  pause(teamId, meetingId) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/pause`);
  },
  resume(teamId, meetingId) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/resume`);
  },
  end(teamId, meetingId) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/end`);
  },

  setParticipantJoined(teamId, meetingId, userId, joined) {
    return apiClient.patch(`/teams/${teamId}/meetings/${meetingId}/participants/${userId}`, { joined });
  },
  setParticipantScore(teamId, meetingId, userId, score, note) {
    return apiClient.patch(`/teams/${teamId}/meetings/${meetingId}/participants/${userId}/score`, { score, note });
  },

  checkinNext(teamId, meetingId) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/checkin/next`);
  },
  checkinSkip(teamId, meetingId) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/checkin/skip`);
  },
  checkinSelect(teamId, meetingId, userId) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/checkin/select`, { user_id: userId });
  },
  checkinReset(teamId, meetingId) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/checkin/reset`);
  },

  // agenda
  addAgendaItem(teamId, meetingId, payload) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/agenda`, payload);
  },
  updateAgendaItem(teamId, meetingId, itemId, payload) {
    return apiClient.patch(`/teams/${teamId}/meetings/${meetingId}/agenda/${itemId}`, payload);
  },
  deleteAgendaItem(teamId, meetingId, itemId) {
    return apiClient.delete(`/teams/${teamId}/meetings/${meetingId}/agenda/${itemId}`);
  },
  reorderAgenda(teamId, meetingId, items) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/agenda/reorder`, items);
  },
  advanceAgenda(teamId, meetingId) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/agenda/next`);
  },

  // notes
  addNote(teamId, meetingId, payload) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/notes`, payload);
  },
  updateNote(teamId, meetingId, noteId, payload) {
    return apiClient.patch(`/teams/${teamId}/meetings/${meetingId}/notes/${noteId}`, payload);
  },
  deleteNote(teamId, meetingId, noteId) {
    return apiClient.delete(`/teams/${teamId}/meetings/${meetingId}/notes/${noteId}`);
  },

  // decisions
  addDecision(teamId, meetingId, payload) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/decisions`, payload);
  },
  deleteDecision(teamId, meetingId, decisionId) {
    return apiClient.delete(`/teams/${teamId}/meetings/${meetingId}/decisions/${decisionId}`);
  },

  // tasks
  createTask(teamId, meetingId, payload) {
    return apiClient.post(`/teams/${teamId}/meetings/${meetingId}/tasks`, payload);
  },

  // summary
  summary(teamId, meetingId) {
    return apiClient.get(`/teams/${teamId}/meetings/${meetingId}/summary`);
  },
};
