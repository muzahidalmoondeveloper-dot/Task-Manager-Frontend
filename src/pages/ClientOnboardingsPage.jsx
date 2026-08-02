import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import Select from "../components/Select";
import { onboardingApi } from "../api/onboardingApi";
import { userApi } from "../api/userApi";
import { projectApi } from "../api/projectApi";
import InviteClientModal from "../components/onboarding/InviteClientModal";
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
};

export function formatStatusLabel(status) {
  return (status || "").replace(/_/g, " ");
}

const initialForm = { client_user_id: "", project_id: "", project_manager_id: "", template_id: "", due_date: "" };

export default function ClientOnboardingsPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const isAdmin = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin;
  const isProjectManager = user?.role === "project_manager" || user?.is_project_manager;
  const canAccess = isAdmin || isProjectManager;

  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [duplicateOnboardingId, setDuplicateOnboardingId] = useState(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  const clients = useMemo(() => users.filter((u) => u.role === "client"), [users]);
  const managers = useMemo(() => users.filter((u) => u.role === "project_manager" || u.is_project_manager), [users]);

  useEffect(() => {
    if (!canAccess) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  async function load() {
    setIsLoading(true);
    try {
      const data = await onboardingApi.list();
      setRecords(Array.isArray(data) ? data : []);
      if (isAdmin) {
        const [userData, projectData, templateData] = await Promise.all([
          userApi.list().catch(() => []),
          projectApi.list().catch(() => []),
          onboardingApi.listTemplates().catch(() => []),
        ]);
        setUsers(userData);
        setProjects(projectData);
        setTemplates(templateData);
      }
    } catch (err) {
      toast.error(err.message || "Unable to load onboarding records.");
    } finally {
      setIsLoading(false);
    }
  }

  function openCreate() {
    setForm(initialForm);
    setFormError("");
    setDuplicateOnboardingId(null);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.client_user_id || !form.project_id) {
      setFormError("Please select a client and a project.");
      return;
    }
    setIsSaving(true);
    setFormError("");
    setDuplicateOnboardingId(null);
    try {
      await onboardingApi.create({
        client_user_id: Number(form.client_user_id),
        project_id: Number(form.project_id),
        project_manager_id: form.project_manager_id ? Number(form.project_manager_id) : null,
        template_id: form.template_id ? Number(form.template_id) : null,
        due_date: form.due_date || null,
      });
      toast.success("Client onboarding created.");
      closeModal();
      load();
    } catch (err) {
      setFormError(err.message || "Unable to create onboarding record.");
      if (err.code === "DUPLICATE_ACTIVE_ONBOARDING" && err.details?.onboarding_id) {
        setDuplicateOnboardingId(err.details.onboarding_id);
      }
      toast.error(err.message || "Unable to create onboarding record.");
    } finally {
      setIsSaving(false);
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

  if (!canAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Client Onboarding</h1>
          <p className="mt-1 text-sm text-slate-500">Track each client's onboarding checklist and progress.</p>
        </div>
        {canAccess && (
          <div className="flex w-fit gap-2">
            <button type="button" onClick={() => setIsInviteModalOpen(true)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Invite Client
            </button>
            {isAdmin && (
              <button type="button" onClick={openCreate}
                className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                + New Onboarding
              </button>
            )}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Client</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Project</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Project Manager</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Progress</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Due Date</th>
                {isAdmin && <th className="px-4 py-3 text-right font-semibold text-slate-700">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-10 text-center text-sm text-slate-400">Loading...</td></tr>
              ) : records.length ? (
                records.map((r) => (
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
                          <div className="h-full rounded-full bg-slate-900" style={{ width: `${r.progress_percentage}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{r.progress_percentage}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-middle text-slate-500">{r.due_date || "—"}</td>
                    {isAdmin && (
                      <td className="px-4 py-4 align-middle text-right">
                        <button type="button" onClick={(e) => handleDelete(r, e)}
                          className="text-xs font-semibold text-red-600 hover:underline">
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-16 text-center text-sm text-slate-500">No onboarding records yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">New Client Onboarding</h2>
              <button type="button" onClick={closeModal}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            {formError && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {formError}
                {duplicateOnboardingId && (
                  <>
                    {" "}
                    <button type="button" onClick={() => navigate(`/onboarding/${duplicateOnboardingId}`)}
                      className="font-semibold underline hover:text-red-800">
                      View existing onboarding
                    </button>
                  </>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Client *</label>
                <Select value={form.client_user_id} onChange={(e) => setForm({ ...form, client_user_id: e.target.value })} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">Select client</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.email}</option>)}
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Project *</label>
                <Select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">Select project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Project Manager</label>
                  <Select value={form.project_manager_id} onChange={(e) => setForm({ ...form, project_manager_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Unassigned</option>
                    {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Template</label>
                  <Select value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">No template</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Due Date</label>
                <input type="date" value={form.due_date} min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={isSaving}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {isSaving ? "Saving…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <InviteClientModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
      />
    </div>
  );
}
