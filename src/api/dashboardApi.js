import { apiClient } from "./client";

export const dashboardApi = {
  getSummary() {
    return apiClient.get("/dashboard/summary");
  },
};
