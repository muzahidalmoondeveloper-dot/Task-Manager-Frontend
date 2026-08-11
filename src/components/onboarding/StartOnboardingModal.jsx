import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import DatePicker from "../DatePicker";
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
  template_id: "",
  due_date: "",
  expires_in_days: 3,
  message: "",
};

/**
 * The single "Start Client Onboarding" flow — replaces the old separate
 * "Invite Client" and "+ New Onboarding" actions/modals. One form, two
 * outcomes decided automatically by whether an existing client account is
 * selected:
 *  - Existing client → creates the ClientOnboarding record directly
 *    (POST /client-onboardings). No user account is created or duplicated.
 *  - New client (no existing account selected) → sends a client invitation
 *    (POST /client-invitations); accepting it is what creates both the
 *    user account and the ClientOnboarding record together.
 * Used both from the central Client Onboarding page and as a shortcut
 * from inside a project (via lockedProjectId).
 *
 * No Project Manager field — the project already has one assigned via
 * ProjectMembership (see ProjectDetailPage's "Project Managers" section);
 * the backend derives it automatically instead of asking for it again here.
 */
export default function StartOnboardingModal({ isOpen, onClose, onCreated, lockedProjectId = null }) {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);

  const [form, setForm] = useState(initialForm);
  const [templateTouched, setTemplateTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [duplicateOnboardingId, setDuplicateOnboardingId] = useState(null);
  const [clientSearch, setClientSearch] = useState("");

  const isExistingClient = Boolean(form.client_user_id);
  const existingClients = useMemo(() => users.filter((u) => u.role === "client"), [users]);
  // Only real, usable templates — active and with at least one step. A
  // template with zero steps can't back a real onboarding checklist, so it's
  // excluded from selection the same way the backend rejects it at create time.
  const usableTemplates = useMemo(
    () => templates.filter((t) => t.is_active && t.steps?.length > 0),
    [templates]
  );
  const defaultTemplate = useMemo(() => usableTemplates.find((t) => t.is_default) || null, [usableTemplates]);
  const hasNoUsableTemplate = !isLoadingOptions && usableTemplates.length === 0;
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
    });
    setTemplateTouched(false);
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
  }, [isOpen, lockedProjectId]);

  // Each org has exactly one active default template — preselect it as soon
  // as it loads, unless the user has already deliberately picked one.
  useEffect(() => {
    if (!templateTouched && defaultTemplate && !form.template_id) {
      setForm((current) => ({ ...current, template_id: String(defaultTemplate.id) }));
    }
  }, [defaultTemplate, templateTouched, form.template_id]);

  function selectExistingClient(client) {
    setForm((current) => ({ ...current, client_user_id: client.id, client_name: client.full_name || "", email: client.email }));
    setClientSearch("");
  }

  function clearExistingClient() {
    setForm((current) => ({ ...current, client_user_id: "" }));
  }

  async function handleSubmit(event, saveAsDraft = false) {
    event.preventDefault();
    if (!form.project_id) {
      setFormError("Please select a project.");
      return;
    }
    if (!isExistingClient && !form.email.trim()) {
      setFormError("Client email is required for a new client.");
      return;
    }
    const templateId = form.template_id ? Number(form.template_id) : (defaultTemplate ? defaultTemplate.id : null);
    if (!templateId) {
      setFormError("Create or configure an onboarding template first.");
      return;
    }

    setIsSaving(true);
    setFormError("");
    setDuplicateOnboardingId(null);
    try {
      if (isExistingClient) {
        const onboarding = await onboardingApi.create({
          client_user_id: Number(form.client_user_id),
          project_id: Number(form.project_id),
          // No project_manager_id — the backend derives it from the project's
          // existing assignment (ProjectMembership) automatically.
          template_id: templateId,
          due_date: form.due_date || null,
        });
        toast.success("Client onboarding started.");
        onCreated?.(onboarding);
        onClose();
      } else {
        const invitation = await clientInvitationApi.invite({
          email: form.email.trim(),
          client_name: form.client_name.trim() || null,
          company_name: form.company_name.trim() || null,
          phone_number: form.phone_number.trim() || null,
          project_id: Number(form.project_id),
          // No project_manager_id — the backend derives it from the project's
          // existing assignment (ProjectMembership) automatically.
          onboarding_template_id: templateId,
          due_date: form.due_date || null,
          message: form.message.trim() || null,
          expires_in_days: Number(form.expires_in_days) || 3,
          save_as_draft: saveAsDraft,
        });
        toast.success(saveAsDraft ? "Draft invitation saved." : "Invitation sent — onboarding will start once they accept.");
        onCreated?.(invitation);
        onClose();
      }
    } catch (err) {
      setFormError(err.message || "Unable to start this onboarding.");
      if (err.code === "DUPLICATE_ACTIVE_ONBOARDING" && err.details?.onboarding_id) {
        setDuplicateOnboardingId(err.details.onboarding_id);
      }
      toast.error(err.message || "Unable to start this onboarding.");
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
            <h2 className="text-xl font-semibold text-slate-900">Start Client Onboarding</h2>
            <p className="mt-1 text-sm text-slate-500">
              {isExistingClient
                ? "Creates the onboarding checklist for this client right away."
                : "New clients get an email to set up their account; onboarding starts once they accept."}
            </p>
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
          {!isExistingClient && (
            <div className="relative">
              <label className="mb-1 block text-sm font-medium text-slate-700">Client</label>
              <input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search an existing client, or type a new client's name/email below..."
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

          {isExistingClient && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Existing client — <span className="font-semibold">{form.email}</span>
              <button type="button" onClick={clearExistingClient} className="font-semibold text-slate-500 hover:text-slate-800">Change</button>
            </div>
          )}

          {!isExistingClient && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Client name</label>
                <input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Client email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          {!isExistingClient && (
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
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Project *</label>
            <Select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} required
              disabled={Boolean(lockedProjectId)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50">
              <option value="">Select project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Template{defaultTemplate && !templateTouched ? " (default)" : ""}
            </label>
            <Select
              value={form.template_id}
              onChange={(e) => { setTemplateTouched(true); setForm({ ...form, template_id: e.target.value }); }}
              disabled={hasNoUsableTemplate}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            >
              <option value="">{hasNoUsableTemplate ? "No templates available" : "Select template"}</option>
              {usableTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>)}
            </Select>
            {hasNoUsableTemplate && (
              <p className="mt-1 text-xs text-red-600">Create or configure an onboarding template first.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Due date</label>
            <DatePicker value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>

          {!isExistingClient && (
            <>
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
            </>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            {!isExistingClient && (
              <button type="button" disabled={isSaving || isLoadingOptions || hasNoUsableTemplate} onClick={(e) => handleSubmit(e, true)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                Save Draft
              </button>
            )}
            <button type="submit" disabled={isSaving || isLoadingOptions || hasNoUsableTemplate}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {isSaving ? "Starting…" : isExistingClient ? "Start Onboarding" : "Send Invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
