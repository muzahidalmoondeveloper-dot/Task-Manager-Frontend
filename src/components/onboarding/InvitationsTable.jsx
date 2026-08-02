import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

const STATUS_BADGE = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-sky-100 text-sky-700",
  opened: "bg-indigo-100 text-indigo-700",
  accepted: "bg-emerald-100 text-emerald-700",
  expired: "bg-amber-100 text-amber-700",
  revoked: "bg-red-100 text-red-700",
};

function acceptUrl(token) {
  return `${window.location.origin}/accept-invitation?token=${encodeURIComponent(token)}`;
}

export default function InvitationsTable({ invitations, isLoading, showProject = true, onResend, onRevoke, onDeleteDraft, onRemove }) {
  const navigate = useNavigate();

  async function copyLink(invitation) {
    try {
      await navigator.clipboard.writeText(acceptUrl(invitation.token));
      toast.success("Invitation link copied.");
    } catch {
      toast.error("Unable to copy link.");
    }
  }

  if (isLoading) {
    return <p className="px-1 py-8 text-center text-sm text-slate-500">Loading invitations...</p>;
  }
  if (invitations.length === 0) {
    return <p className="px-1 py-8 text-center text-sm text-slate-400">No client invitations yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-50">
          <tr className="border-b border-slate-200">
            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Client</th>
            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Email</th>
            {showProject && <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Project</th>}
            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Project Manager</th>
            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Template</th>
            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Sent</th>
            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Expires</th>
            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Status</th>
            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Invited by</th>
            <th className="px-3 py-2.5 text-right font-semibold text-slate-700">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invitations.map((inv) => (
            <tr key={inv.id} className="hover:bg-slate-50/70">
              <td className="px-3 py-3 align-middle font-medium text-slate-900">{inv.client_name || "—"}</td>
              <td className="px-3 py-3 align-middle text-slate-600">{inv.email}</td>
              {showProject && <td className="px-3 py-3 align-middle text-slate-600">{inv.project?.name || "—"}</td>}
              <td className="px-3 py-3 align-middle text-slate-600">{inv.project_manager?.full_name || "—"}</td>
              <td className="px-3 py-3 align-middle text-slate-600">{inv.onboarding_template?.name || "—"}</td>
              <td className="px-3 py-3 align-middle text-slate-500">{new Date(inv.created_at).toLocaleDateString()}</td>
              <td className="px-3 py-3 align-middle text-slate-500">{new Date(inv.expires_at).toLocaleDateString()}</td>
              <td className="px-3 py-3 align-middle">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[inv.status] || STATUS_BADGE.sent}`}>
                  {inv.status}
                </span>
              </td>
              <td className="px-3 py-3 align-middle text-slate-500">{inv.invited_by?.full_name || inv.invited_by?.email}</td>
              <td className="px-3 py-3 align-middle">
                <div className="flex flex-wrap justify-end gap-2 text-xs font-semibold">
                  {(inv.status === "sent" || inv.status === "opened" || inv.status === "expired") && (
                    <>
                      <button type="button" onClick={() => onResend(inv.id)} className="text-slate-600 hover:underline">Resend</button>
                      <button type="button" onClick={() => copyLink(inv)} className="text-slate-600 hover:underline">Copy link</button>
                      <button type="button" onClick={() => onRevoke(inv.id)} className="text-red-600 hover:underline">Revoke</button>
                    </>
                  )}
                  {inv.status === "draft" && (
                    <button type="button" onClick={() => onDeleteDraft(inv.id)} className="text-red-600 hover:underline">Delete</button>
                  )}
                  {inv.status === "accepted" && inv.onboarding_id && (
                    <button type="button" onClick={() => navigate(`/onboarding/${inv.onboarding_id}`)} className="text-slate-600 hover:underline">
                      View onboarding
                    </button>
                  )}
                  {(inv.status === "accepted" || inv.status === "expired" || inv.status === "revoked") && (
                    <button type="button" onClick={() => onRemove(inv.id)} className="text-red-600 hover:underline">Remove</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
