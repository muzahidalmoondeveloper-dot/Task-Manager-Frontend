import { apiClient } from "./client";

function buildQuery(params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return qs ? `?${qs}` : "";
}

export const activityLogApi = {
  /** Owner/Admin only (backend-enforced) — organization-wide activity, newest first. */
  list(params = {}) {
    return apiClient.get(`/activity-logs${buildQuery(params)}`);
  },
};
