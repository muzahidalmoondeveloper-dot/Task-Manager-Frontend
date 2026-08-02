import { apiClient } from "./client";

export const billingApi = {
  getStatus() {
    return apiClient.get("/billing/status");
  },
  getSubscription() {
    return apiClient.get("/organizations/current/subscription");
  },
  getUsage() {
    return apiClient.get("/organizations/current/usage");
  },
  createPortalSession() {
    return apiClient.post("/billing/portal-session");
  },
  updateAddons(extraTeams, extraUsers) {
    return apiClient.put("/billing/addons", { extra_teams: extraTeams, extra_users: extraUsers });
  },
};
