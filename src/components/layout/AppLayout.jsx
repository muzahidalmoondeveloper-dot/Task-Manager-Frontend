import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import toast from "react-hot-toast";

import { notificationApi } from "../../api/notificationApi";
import { billingApi } from "../../api/billingApi";
import { useAuth } from "../../context/AuthContext";
import CelebrationOverlay from "../CelebrationOverlay";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";
import ChatWidget from "../chat/ChatWidget";

const POLL_INTERVAL_MS = 15_000;
const BILLING_POLL_INTERVAL_MS = 5 * 60_000;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function AppLayout() {
  const { user } = useAuth();
  const [celebrationTaskName, setCelebrationTaskName] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [billingStatus, setBillingStatus] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const seenIdsRef = useRef(new Set());

  const isOrgAdmin = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin;

  const pollBillingStatus = useCallback(async () => {
    if (!user) return;
    try {
      const status = await billingApi.getStatus();
      setBillingStatus(status);
    } catch {
      // silent — polling failures shouldn't disrupt the UI
    }
  }, [user]);

  useEffect(() => {
    pollBillingStatus();
    const id = setInterval(pollBillingStatus, BILLING_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollBillingStatus]);

  async function handleAddPayment() {
    setPortalLoading(true);
    try {
      const { url } = await billingApi.createPortalSession();
      window.location.href = url;
    } catch (err) {
      toast.error(err.message || "Failed to open billing portal.");
      setPortalLoading(false);
    }
  }

  const pollNotifications = useCallback(async () => {
    if (!user) return;

    try {
      const notifications = await notificationApi.listUnread();
      setUnreadCount(notifications.length);

      const approvals = notifications.filter((n) => n.type === "task_approved");

      for (const n of approvals) {
        if (seenIdsRef.current.has(n.id)) continue;

        seenIdsRef.current.add(n.id);
        await notificationApi.markRead(n.id);
        setUnreadCount((prev) => Math.max(0, prev - 1));

        const match = n.message.match(/^Your task '(.+)' was approved\.$/);
        setCelebrationTaskName(match ? match[1] : n.title);
        break;
      }
    } catch {
      // silent — polling failures shouldn't disrupt the UI
    }
  }, [user]);

  useEffect(() => {
    pollNotifications();
    const id = setInterval(pollNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollNotifications]);

  function handleUnreadCountChange(delta) {
    setUnreadCount((prev) => Math.max(0, prev + delta));
  }

  const trialDaysLeft = billingStatus?.status === "trialing" ? daysUntil(billingStatus.trial_ends_at) : null;
  const showTrialBanner = trialDaysLeft !== null;
  const isLocked = Boolean(billingStatus?.is_locked);
  const showBar = !bannerDismissed && (isLocked || showTrialBanner);

  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar onCollapseChange={setSidebarCollapsed} />

      <div
        className={`min-h-screen transition-all duration-300 ${
          sidebarCollapsed ? "lg:pl-20" : "lg:pl-72"
        }`}
      >
        {showBar && (
          <div className={`flex items-center justify-between gap-3 px-4 py-2 text-sm sm:px-6 lg:px-8 ${
            isLocked ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-700"
          }`}>
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .27.144.518.378.653l3.5 2a.75.75 0 00.744-1.302L10.75 9.585V5z" clipRule="evenodd" />
              </svg>
              {isLocked
                ? "Your trial has ended — add a payment method to keep creating new teams, projects, and invites."
                : trialDaysLeft > 0
                ? `Trial ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}.`
                : "Your trial ends today."}
              {isLocked && !isOrgAdmin && " Contact your workspace owner or admin."}
            </span>
            <div className="flex shrink-0 items-center gap-3">
              {isOrgAdmin && (
                <button
                  type="button"
                  onClick={handleAddPayment}
                  disabled={portalLoading}
                  className={`text-sm font-semibold hover:underline disabled:opacity-60 ${isLocked ? "text-red-700" : "text-sky-700"}`}
                >
                  {portalLoading ? "Opening..." : "Upgrade"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className={`text-xs ${isLocked ? "text-red-400 hover:text-red-600" : "text-sky-400 hover:text-sky-600"}`}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <Navbar
          unreadCount={unreadCount}
          onUnreadCountChange={handleUnreadCountChange}
          onUnreadCountReset={() => setUnreadCount(0)}
        />

        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1700px]">
            <Outlet />
          </div>
        </main>
      </div>

      <ChatWidget />

      {celebrationTaskName !== null && (
        <CelebrationOverlay
          taskName={celebrationTaskName}
          onDismiss={() => setCelebrationTaskName(null)}
        />
      )}
    </div>
  );
}
