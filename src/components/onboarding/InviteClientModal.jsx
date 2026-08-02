import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import Select from "../Select";
import { clientInvitationApi } from "../../api/clientInvitationApi";
import { onboardingApi } from "../../api/onboardingApi";
import { projectApi } from "../../api/projectApi";
import { userApi } from "../../api/userApi";

const initialForm = {
  client_user_id: "",
  client_name: "",
  email: "",
  company_name: "",
  phone_number: "",
  project_id: "",
  project_manager_id: "",
  onboarding_template_id: "",
  expires_in_days: 3,
  message: "",
};

/**
 * Shared "Invite Client" form used both from the central Client Onboarding
 * page and as a shortcut from inside a project. Both entry points call the
 * exact same /client-invitations API so validation, permissions, token
 * generation, email template, and status tracking never diverge.
 */
export default function InviteClientModal({ isOpen, onClose, onInvited, lockedProjectId = null, defaultProjectManagerId = null }) {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);

  const [form, setForm] = useState(initialForm);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [duplicateOnboardingId, setDuplicateOnboardingId] = useState(null);
  const [clientSearch, setClientSearch] = useState("");

  const existingClients = useMemo(() => users.filter((u) => u.role === "client"), [users]);
  const managers = useMemo(() => users.filter((u) => u.role === "project_manager" || u.is_project_manager), [users]);
  const matchingClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return [];
    return existingClients
      .filter((c) => (c.full_name || "").toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .slice(0, 6);
  }, [clientSearch, existingClients]);

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      ...initialForm,
      project_id: lockedProjectId ? String(lockedProjectId) : "",
      project_manager_id: defaultProjectManagerId ? String(defaultProjectManagerId) : "",
    });
    setFormError("");
    setDuplicateOnboardingId(null);
    setClientSearch("");
    setIsLoadingOptions(true);
    Promise.all([
      userApi.list().catch(() => []),
      projectApi.list().catch(() => []),
      onboardingApi.listTemplates().catch(() => []),
    ])
      .then(([userData, projectData, templateData]) => {
        setUsers(userData);
        setProjects(projectData);
        setTemplates(templateData);
      })
      .finally(() => setIsLoadingOptions(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lockedProjectId, defaultProjectManagerId]);

  function selectExistingClient(client) {
    setForm((current) => ({ ...current, client_user_id: client.id, client_name: client.full_name || "", email: client.email }));
    setClientSearch("");
  }

  async function handleSubmit(event, saveAsDraft) {
    event.preventDefault();
    if (!form.email.trim() || !form.project_id) {
      setFormError("Client email and project are required.");
      return;
    }
    setIsSaving(true);
    setFormError("");
    setDuplicateOnboardingId(null);
    try {
      const invitation = await clientInvitationApi.invite({
        email: form.email.trim(),
        client_name: form.client_name.trim() || null,
        company_name: form.company_name.trim() || null,
        phone_number: form.phone_number.trim() || null,
        project_id: Number(form.project_id),
        project_manager_id: form.project_manager_id ? Number(form.project_manager_id) : null,
        onboarding_template_id: form.onboarding_template_id ? Number(form.onboarding_template_id) : null,
        message: form.message.trim() || null,
        expires_in_days: Number(form.expires_in_days) || 3,
        save_as_draft: saveAsDraft,
      });
      toast.success(saveAsDraft ? "Draft invitation saved." : "Invitation sent.");
      onInvited?.(invitation);
      onClose();
    } catch (err) {
      setFormError(err.message || "Unable to send this invitation.");
      if (err.code === "DUPLICATE_ACTIVE_ONBOARDING" && err.details?.onboarding_id) {
        setDuplicateOnboardingId(err.details.onboarding_id);
      }
      toast.error(err.message || "Unable to send this invitation.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Invite Client</h2>
            <p className="mt-1 text-sm text-slate-500">They'll get an email to set up their account and start onboarding.</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">✕</button>
        </div>

        {formError && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
            {duplicateOnboardingId && (
              <>
                {" "}
                <button type="button" onClick={() => { onClose(); navigate(`/onboarding/${duplicateOnboardingId}`); }}
                  className="font-semibold underline hover:text-red-800">
                  View existing onboarding
                </button>
              </>
            )}
          </div>
        )}

        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-4">
          {!form.client_user_id && (
            <div className="relative">
              <label className="mb-1 block text-sm font-medium text-slate-700">Search existing clients</label>
              <input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Type a name or email to reuse an existing client..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {matchingClients.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                  {matchingClients.map((c) => (
                    <button key={c.id} type="button" onClick={() => selectExistingClient(c)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{c.full_name || c.email}</span>
                      {c.full_name && <span className="ml-1.5 text-xs text-slate-400">{c.email}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {form.client_user_id && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Using existing client account for <span className="font-semibold">{form.email}</span>
              <button type="button" onClick={() => setForm((c) => ({ ...c, client_user_id: "" }))} className="font-semibold text-slate-500 hover:text-slate-800">Clear</button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Client name</label>
              <input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Client email *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required
                disabled={Boolean(form.client_user_id)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Company name</label>
              <input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Phone number</label>
              <input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Project *</label>
            <Select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} required
              disabled={Boolean(lockedProjectId)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50">
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
              <label className="mb-1 block text-sm font-medium text-slate-700">Onboarding template</label>
              <Select value={form.onboarding_template_id} onChange={(e) => setForm({ ...form, onboarding_template_id: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">No template</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Invitation expires in (days)</label>
            <input type="number" min={1} max={30} value={form.expires_in_days}
              onChange={(e) => setForm({ ...form, expires_in_days: e.target.value })}
              className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Message (optional)</label>
            <textarea rows={2} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="A personal note included in the invitation email..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="button" disabled={isSaving || isLoadingOptions} onClick={(e) => handleSubmit(e, true)}
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              Save Draft
            </button>
            <button type="submit" disabled={isSaving || isLoadingOptions}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {isSaving ? "Sending…" : "Send Invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
