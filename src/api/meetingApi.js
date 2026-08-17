import { apiClient } from "./client";

// Meetings are not team-specific — every call is on the flat /meetings
// resource. `teamId` is now just an optional field on the meeting itself
// (and an optional filter here), never part of the URL.
export const meetingApi = {
  list(filter, teamId) {
    const params = new URLSearchParams();
    if (filter) params.set("filter", filter);
    if (teamId) params.set("team_id", teamId);
    const qs = params.toString();
    return apiClient.get(`/meetings${qs ? `?${qs}` : ""}`);
  },
  create(payload) {
    return apiClient.post(`/meetings`, payload);
  },
  checkTitle(title) {
    return apiClient.get(`/meetings/check-title?title=${encodeURIComponent(title)}`);
  },
  get(meetingId) {
    return apiClient.get(`/meetings/${meetingId}`);
  },
  update(meetingId, payload) {
    return apiClient.patch(`/meetings/${meetingId}`, payload);
  },
  delete(meetingId) {
    return apiClient.delete(`/meetings/${meetingId}`);
  },

  // lifecycle
  start(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/start`);
  },
  pause(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/pause`);
  },
  resume(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/resume`);
  },
  end(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/end`);
  },
  sendSummary(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/send-summary`);
  },

  setParticipantJoined(meetingId, userId, joined) {
    return apiClient.patch(`/meetings/${meetingId}/participants/${userId}`, { joined });
  },
  setParticipantScore(meetingId, userId, score, note) {
    return apiClient.patch(`/meetings/${meetingId}/participants/${userId}/score`, { score, note });
  },

  checkinNext(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/checkin/next`);
  },
  checkinSkip(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/checkin/skip`);
  },
  checkinSelect(meetingId, userId) {
    return apiClient.post(`/meetings/${meetingId}/checkin/select`, { user_id: userId });
  },
  checkinReset(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/checkin/reset`);
  },

  // agenda
  addAgendaItem(meetingId, payload) {
    return apiClient.post(`/meetings/${meetingId}/agenda`, payload);
  },
  updateAgendaItem(meetingId, itemId, payload) {
    return apiClient.patch(`/meetings/${meetingId}/agenda/${itemId}`, payload);
  },
  deleteAgendaItem(meetingId, itemId) {
    return apiClient.delete(`/meetings/${meetingId}/agenda/${itemId}`);
  },
  reorderAgenda(meetingId, items) {
    return apiClient.post(`/meetings/${meetingId}/agenda/reorder`, items);
  },
  advanceAgenda(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/agenda/next`);
  },
  selectAgendaItem(meetingId, itemId) {
    return apiClient.post(`/meetings/${meetingId}/agenda/${itemId}/select`);
  },

  // recording -> transcript -> AI task extraction. No audio ever leaves the
  // browser via this API — only the transcript text produced by the
  // browser's own speech recognition; the backend stores it and runs the
  // existing AI task extractor against it.
  startRecording(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/recording/start`);
  },
  stopRecording(meetingId, transcriptText) {
    return apiClient.post(`/meetings/${meetingId}/recording/stop`, { text: transcriptText });
  },
  cancelRecording(meetingId) {
    return apiClient.post(`/meetings/${meetingId}/recording/cancel`);
  },

  // live reactions (ephemeral — not meeting history, see backend app.core.meeting_reactions)
  sendReaction(meetingId, emoji) {
    return apiClient.post(`/meetings/${meetingId}/reactions`, { emoji });
  },
  listReactionsSince(meetingId, sinceId) {
    return apiClient.get(`/meetings/${meetingId}/reactions?since=${sinceId}`);
  },

  // notes
  addNote(meetingId, payload) {
    return apiClient.post(`/meetings/${meetingId}/notes`, payload);
  },
  updateNote(meetingId, noteId, payload) {
    return apiClient.patch(`/meetings/${meetingId}/notes/${noteId}`, payload);
  },
  deleteNote(meetingId, noteId) {
    return apiClient.delete(`/meetings/${meetingId}/notes/${noteId}`);
  },

  // decisions
  addDecision(meetingId, payload) {
    return apiClient.post(`/meetings/${meetingId}/decisions`, payload);
  },
  deleteDecision(meetingId, decisionId) {
    return apiClient.delete(`/meetings/${meetingId}/decisions/${decisionId}`);
  },

  // tasks
  createTask(meetingId, payload) {
    return apiClient.post(`/meetings/${meetingId}/tasks`, payload);
  },
  // Links an EXISTING task (vs createTask, which makes a new one) —
  // used by the suggested-tasks "add to agenda" flow.
  linkTask(meetingId, taskId, agendaItemId) {
    return apiClient.post(`/meetings/${meetingId}/tasks/link`, { task_id: taskId, agenda_item_id: agendaItemId ?? null });
  },

  // summary
  summary(meetingId) {
    return apiClient.get(`/meetings/${meetingId}/summary`);
  },

  // Linked Task Integration (plan section 7) — overdue/high-priority tasks
  // and unresolved issues, optionally narrowed to a team and/or project.
  suggestedTasks(teamId, projectId) {
    const params = new URLSearchParams();
    if (teamId) params.set("team_id", teamId);
    if (projectId) params.set("project_id", projectId);
    const qs = params.toString();
    return apiClient.get(`/meetings/suggested-tasks${qs ? `?${qs}` : ""}`);
  },
};
