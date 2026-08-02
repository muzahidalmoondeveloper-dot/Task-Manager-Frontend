import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";

import { clientInvitationApi } from "../api/clientInvitationApi";
import InviteClientModal from "../components/onboarding/InviteClientModal";
import InvitationsTable from "../components/onboarding/InvitationsTable";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";

export default function ClientInvitationsPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const isAdmin = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin;
  const isProjectManager = user?.role === "project_manager" || user?.is_project_manager;
  const canAccess = isAdmin || isProjectManager;

  const [invitations, setInvitations] = useState([]);
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
      const data = await clientInvitationApi.list();
      setInvitations(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.message || "Unable to load invitations.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResend(id) {
    try {
      await clientInvitationApi.resend(id);
      toast.success("Invitation resent.");
      load();
    } catch (err) {
      toast.error(err.message || "Unable to resend this invitation.");
    }
  }

  async function handleRevoke(id) {
    if (!(await confirm({ message: "Revoke this invitation? The link will stop working immediately.", tone: "danger", confirmLabel: "Revoke" }))) return;
    try {
      await clientInvitationApi.revoke(id);
      toast.success("Invitation revoked.");
      load();
    } catch (err) {
      toast.error(err.message || "Unable to revoke this invitation.");
    }
  }

  async function handleDeleteDraft(id) {
    if (!(await confirm({ message: "Delete this draft invitation?", tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await clientInvitationApi.deleteDraft(id);
      setInvitations((current) => current.filter((i) => i.id !== id));
      toast.success("Draft deleted.");
    } catch (err) {
      toast.error(err.message || "Unable to delete this draft.");
    }
  }

  async function handleRemove(id) {
    if (!(await confirm({ message: "Remove this invitation from the list? This does not affect the client's project access.", tone: "danger", confirmLabel: "Remove" }))) return;
    try {
      await clientInvitationApi.deleteDraft(id);
      setInvitations((current) => current.filter((i) => i.id !== id));
      toast.success("Invitation removed.");
    } catch (err) {
      toast.error(err.message || "Unable to remove this invitation.");
    }
  }

  if (!canAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Client Invitations</h1>
          <p className="mt-1 text-sm text-slate-500">Send, track, and manage invitations to onboard new clients.</p>
        </div>
        <button type="button" onClick={() => setIsModalOpen(true)}
          className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
          + Invite Client
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <InvitationsTable
          invitations={invitations}
          isLoading={isLoading}
          onResend={handleResend}
          onRevoke={handleRevoke}
          onDeleteDraft={handleDeleteDraft}
          onRemove={handleRemove}
        />
      </div>

      <InviteClientModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onInvited={load}
      />
    </div>
  );
}
