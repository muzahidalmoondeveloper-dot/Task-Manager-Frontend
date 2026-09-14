import { apiClient } from "./client";

export const integrationApi = {
  accounts() {
    return apiClient.get("/integrations/accounts");
  },

  connectGoogle() {
    return apiClient.get("/integrations/google/connect");
  },

  connectMicrosoft() {
    return apiClient.get("/integrations/microsoft/connect");
  },

  syncMicrosoftRecent() {
    return apiClient.post("/integrations/microsoft/sync-recent", {});
  },

  // Automation Pipeline Audit follow-up: Gmail previously had no sync
  // path at all (OAuth only). Mirrors syncMicrosoftRecent() exactly.
  syncGoogleRecent() {
    return apiClient.post("/integrations/google/sync-recent", {});
  },

  disconnectAccount(accountId) {
    return apiClient.delete(`/integrations/accounts/${accountId}`);
  },

  // "Connected" is not "Automation Working" — per-account last-sync
  // checkpoint/status/error plus its most recent Sync Run.
  status() {
    return apiClient.get("/integrations/status");
  },

  // Automation Activity feed — paginated Sync Run history.
  syncRuns({ provider, limit = 20, offset = 0 } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (provider) params.set("provider", provider);
    return apiClient.get(`/integrations/sync-runs?${params.toString()}`);
  },

  // Automation Activity feed — paginated per-item (email/transcript) history.
  activityItems({ limit = 20, offset = 0 } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return apiClient.get(`/integrations/activity-items?${params.toString()}`);
  },
};