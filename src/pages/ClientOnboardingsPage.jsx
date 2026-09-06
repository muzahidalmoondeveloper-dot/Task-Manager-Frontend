import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { onboardingApi } from "../api/onboardingApi";
import { clientInvitationApi } from "../api/clientInvitationApi";
import StartOnboardingModal from "../components/onboarding/StartOnboardingModal";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";

export const STATUS_BADGE = {
  draft: "bg-slate-100 text-slate-600",
  invited: "bg-sky-100 text-sky-700",
  client_registered: "bg-sky-100 text-sky-700",
  in_progress: "bg-blue-100 text-blue-700",
  waiting_for_client: "bg-amber-100 text-amber-700",
  under_review: "bg-amber-100 text-amber-700",
  changes_requested: "bg-orange-100 text-orange-700",
  waiting_for_internal_team: "bg-amber-100 text-amber-700",
  ready_for_approval: "bg-indigo-100 text-indigo-700",
  completed: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-red-100 text-red-700",
  archived: "bg-slate-100 text-slate-500",
  // Pending-invitation statuses (client hasn't accepted yet, so there's no
  // ClientOnboarding record at all — these rows represent an onboarding
  // that's been *started* but not yet begun).
  invitation_sent: "bg-sky-100 text-sky-700",
  invitation_opened: "bg-indigo-100 text-indigo-700",
  invitation_expired: "bg-amber-100 text-amber-700",
  invitation_revoked: "bg-red-100 text-red-700",
};

export function formatStatusLabel(status) {
  return (status || "").replace(/_/g, " ");
}

export default function ClientOnboardingsPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const isAdmin = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin;
  const isProjectManager = user?.role === "project_manager" || user?.is_project_manager;
  const canAccess = isAdmin || isProjectManager;

  const [records, setRecords] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!canAccess) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  async function load() {
    setIsLoading(true);
    try {
      const [onboardings, invitations] = await Promise.all([
        onboardingApi.list(),
        clientInvitationApi.list().catch(() => []),
      ]);
      setRecords(Array.isArray(onboardings) ? onboardings : []);
      // A pending invitation is one that hasn't been accepted (and hasn't
      // already produced an onboarding record another way) — invitation
      // status management (resend/revoke/expiry) stays right here on these
      // rows instead of a separate "Invitations" page/concept.
      setPendingInvitations(
        (Array.isArray(invitations) ? invitations : []).filter((inv) => inv.status !== "accepted")
      );
    } catch (err) {
      toast.error(err.message || "Unable to load onboarding records.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(record, event) {
    event.stopPropagation();
    const ok = await confirm({
      message: `Remove the onboarding record for ${record.client?.full_name || record.client?.email}? This permanently deletes its steps, responses, and documents.`,
      tone: "danger",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await onboardingApi.remove(record.id);
      setRecords((current) => current.filter((r) => r.id !== record.id));
      toast.success("Onboarding record removed.");
    } catch (err) {
      toast.error(err.message || "Unable to remove this onboarding record.");
    }
  }

  async function handleResendInvitation(id, event) {
    event.stopPropagation();
    try {
      await clientInvitationApi.resend(id);
      toast.success("Invitation resent.");
      load();
    } catch (err) {
      toast.error(err.message || "Unable to resend this invitation.");
    }
  }

  async function handleRevokeInvitation(id, event) {
    event.stopPropagation();
    if (!(await confirm({ message: "Revoke this invitation? The link will stop working immediately.", tone: "danger", confirmLabel: "Revoke" }))) return;
    try {
      await clientInvitationApi.revoke(id);
      toast.success("Invitation revoked.");
      load();
    } catch (err) {
      toast.error(err.message || "Unable to revoke this invitation.");
    }
  }

  async function handleDeleteDraftInvitation(id, event) {
    event.stopPropagation();
    if (!(await confirm({ message: "Delete this draft invitation?", tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await clientInvitationApi.deleteDraft(id);
      setPendingInvitations((current) => current.filter((i) => i.id !== id));
      toast.success("Draft deleted.");
    } catch (err) {
      toast.error(err.message || "Unable to delete this draft.");
    }
  }

  if (!canAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  const isEmpty = !isLoading && records.length === 0 && pendingInvitations.length === 0;

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Client Onboarding</h1>
          <p className="mt-1 text-sm text-slate-500">Track each client's onboarding checklist and progress.</p>
        </div>
        <button type="button" onClick={() => setIsModalOpen(true)}
          className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
          + Start Client Onboarding
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Client</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Project</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Project Manager</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Progress</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Due Date</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">Loading...</td></tr>
              ) : isEmpty ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-slate-500">No onboarding records yet.</td></tr>
              ) : (
                <>
                  {pendingInvitations.map((inv) => (
                    <tr key={`invitation-${inv.id}`} className="bg-slate-50/40 hover:bg-slate-50">
                      <td className="px-4 py-4 align-middle font-medium text-slate-900">{inv.client_name || inv.email}</td>
                      <td className="px-4 py-4 align-middle text-slate-600">{inv.project?.name || "—"}</td>
                      <td className="px-4 py-4 align-middle text-slate-600">{inv.project_manager?.full_name || "—"}</td>
                      <td className="px-4 py-4 align-middle">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[`invitation_${inv.status}`] || STATUS_BADGE.invitation_sent}`}>
                          Invitation {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-middle text-slate-400">—</td>
                      <td className="px-4 py-4 align-middle text-slate-500">{inv.due_date || "—"}</td>
                      <td className="px-4 py-4 align-middle text-right">
                        <div className="flex flex-wrap justify-end gap-3 text-xs font-semibold">
                          {(inv.status === "sent" || inv.status === "opened" || inv.status === "expired") && (
                            <>
                              <button type="button" onClick={(e) => handleResendInvitation(inv.id, e)} className="text-slate-600 hover:underline">Resend</button>
                              <button type="button" onClick={(e) => handleRevokeInvitation(inv.id, e)} className="text-red-600 hover:underline">Revoke</button>
                            </>
                          )}
                          {inv.status === "draft" && (
                            <button type="button" onClick={(e) => handleDeleteDraftInvitation(inv.id, e)} className="text-red-600 hover:underline">Delete draft</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {records.map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/onboarding/${r.id}`)} className="cursor-pointer hover:bg-slate-50/70">
                      <td className="px-4 py-4 align-middle font-medium text-slate-900">{r.client?.full_name || r.client?.email}</td>
                      <td className="px-4 py-4 align-middle text-slate-600">{r.project?.name}</td>
                      <td className="px-4 py-4 align-middle text-slate-600">{r.project_manager?.full_name || "—"}</td>
                      <td className="px-4 py-4 align-middle">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[r.status] || STATUS_BADGE.draft}`}>
                          {formatStatusLabel(r.status)}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-middle">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div className="brand-fill h-full rounded-full bg-slate-900" style={{ width: `${r.progress_percentage}%` }} />
                          </div>
                          <span className="text-xs text-slate-500">{r.progress_percentage}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-middle text-slate-500">{r.due_date || "—"}</td>
                      <td className="px-4 py-4 align-middle text-right">
                        {isAdmin && (
                          <button type="button" onClick={(e) => handleDelete(r, e)}
                            className="text-xs font-semibold text-red-600 hover:underline">
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <StartOnboardingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreated={load}
      />
    </div>
  );
}
