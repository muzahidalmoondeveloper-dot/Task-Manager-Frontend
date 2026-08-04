import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";

import Select from "../components/Select";
import { onboardingApi } from "../api/onboardingApi";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";

const STEP_TYPE_OPTIONS = [
  { value: "information_form",    label: "Information Form" },
  { value: "questionnaire",       label: "Questionnaire" },
  { value: "document_upload",     label: "Document Upload" },
  { value: "agreement_acceptance", label: "Agreement Acceptance" },
  { value: "payment",             label: "Payment" },
  { value: "meeting",             label: "Meeting" },
  { value: "manual_task",         label: "Manual Task" },
  { value: "approval",            label: "Approval" },
  { value: "custom_step",         label: "Custom Step" },
];

const FIELD_TYPE_OPTIONS = [
  { value: "short_text",  label: "Short Text" },
  { value: "long_text",   label: "Long Text" },
  { value: "email",       label: "Email" },
  { value: "phone",       label: "Phone" },
  { value: "url",         label: "URL" },
  { value: "number",      label: "Number" },
  { value: "date",        label: "Date" },
  { value: "dropdown",    label: "Dropdown" },
  { value: "checkbox",    label: "Checkbox" },
  { value: "multi_select", label: "Multi-select" },
];

const FIELD_TYPES_WITH_OPTIONS = new Set(["dropdown", "multi_select"]);
const FORM_STEP_TYPES = new Set(["information_form", "questionnaire"]);

const initialField = () => ({
  label: "", field_key: "", field_type: "short_text", placeholder: "", help_text: "",
  is_required: false, options_json: [],
});
const initialRequirement = () => ({
  name: "", description: "", is_required: true, allowed_file_types: "", max_file_size_mb: 10,
});
const initialStep = () => ({
  title: "", step_type: "manual_task", is_required: true, requires_approval: false,
  form_fields: [], document_requirements: [],
});
const initialForm = { name: "", description: "", is_default: false, steps: [initialStep()] };

function slugify(label) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
}

export default function OnboardingTemplatesPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const isAdmin = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin;

  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function load() {
    setIsLoading(true);
    try {
      const data = await onboardingApi.listTemplates();
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.message || "Unable to load templates.");
    } finally {
      setIsLoading(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(initialForm);
    setFormError("");
    setIsModalOpen(true);
  }

  function openEdit(template) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      description: template.description || "",
      is_default: template.is_default,
      steps: template.steps.length
        ? template.steps.map((s) => ({
            title: s.title,
            step_type: s.step_type,
            is_required: s.is_required,
            requires_approval: s.requires_approval,
            form_fields: (s.form_fields || []).map((f) => ({
              label: f.label, field_key: f.field_key, field_type: f.field_type,
              placeholder: f.placeholder || "", help_text: f.help_text || "",
              is_required: f.is_required, options_json: f.options_json || [],
            })),
            document_requirements: (s.document_requirements || []).map((d) => ({
              name: d.name, description: d.description || "", is_required: d.is_required,
              allowed_file_types: d.allowed_file_types || "", max_file_size_mb: d.max_file_size_mb ?? 10,
            })),
          }))
        : [initialStep()],
    });
    setFormError("");
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
  }

  function addStep() {
    setForm((current) => ({ ...current, steps: [...current.steps, initialStep()] }));
  }

  function removeStep(index) {
    setForm((current) => ({ ...current, steps: current.steps.filter((_, i) => i !== index) }));
  }

  function updateStep(index, updates) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((s, i) => (i === index ? { ...s, ...updates } : s)),
    }));
  }

  function addField(stepIndex) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((s, i) => (i === stepIndex ? { ...s, form_fields: [...s.form_fields, initialField()] } : s)),
    }));
  }

  function updateField(stepIndex, fieldIndex, updates) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((s, i) =>
        i === stepIndex
          ? { ...s, form_fields: s.form_fields.map((f, j) => (j === fieldIndex ? { ...f, ...updates } : f)) }
          : s
      ),
    }));
  }

  function removeField(stepIndex, fieldIndex) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((s, i) =>
        i === stepIndex ? { ...s, form_fields: s.form_fields.filter((_, j) => j !== fieldIndex) } : s
      ),
    }));
  }

  function moveField(stepIndex, fieldIndex, direction) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((s, i) => {
        if (i !== stepIndex) return s;
        const target = fieldIndex + direction;
        if (target < 0 || target >= s.form_fields.length) return s;
        const fields = [...s.form_fields];
        [fields[fieldIndex], fields[target]] = [fields[target], fields[fieldIndex]];
        return { ...s, form_fields: fields };
      }),
    }));
  }

  function addRequirement(stepIndex) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((s, i) => (i === stepIndex ? { ...s, document_requirements: [...s.document_requirements, initialRequirement()] } : s)),
    }));
  }

  function updateRequirement(stepIndex, reqIndex, updates) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((s, i) =>
        i === stepIndex
          ? { ...s, document_requirements: s.document_requirements.map((r, j) => (j === reqIndex ? { ...r, ...updates } : r)) }
          : s
      ),
    }));
  }

  function removeRequirement(stepIndex, reqIndex) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((s, i) =>
        i === stepIndex ? { ...s, document_requirements: s.document_requirements.filter((_, j) => j !== reqIndex) } : s
      ),
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const validSteps = form.steps.filter((s) => s.title.trim());
    if (validSteps.length === 0) {
      setFormError("Add at least one step with a title.");
      return;
    }
    setIsSaving(true);
    setFormError("");
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        is_default: form.is_default,
        steps: validSteps.map((s, i) => ({
          ...s,
          display_order: i,
          form_fields: (s.form_fields || [])
            .filter((f) => f.label.trim())
            .map((f, j) => ({ ...f, field_key: f.field_key.trim() || slugify(f.label), display_order: j })),
          document_requirements: (s.document_requirements || [])
            .filter((d) => d.name.trim())
            .map((d, j) => ({ ...d, display_order: j })),
        })),
      };
      if (editingId) {
        await onboardingApi.updateTemplate(editingId, payload);
        toast.success("Template updated.");
      } else {
        await onboardingApi.createTemplate(payload);
        toast.success("Template created.");
      }
      closeModal();
      load();
    } catch (err) {
      setFormError(err.message || "Unable to save template.");
      toast.error(err.message || "Unable to save template.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(template) {
    if (template.is_default) {
      toast.error("This is the default template — set another template as default first.");
      return;
    }
    if (!(await confirm({ message: `Delete "${template.name}"?`, tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await onboardingApi.deleteTemplate(template.id);
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      toast.success("Template deleted.");
    } catch (err) {
      toast.error(err.message || "Unable to delete template.");
    }
  }

  async function handleSetDefault(template) {
    try {
      await onboardingApi.updateTemplate(template.id, { is_default: true });
      toast.success(`"${template.name}" is now the default template.`);
      load();
    } catch (err) {
      toast.error(err.message || "Unable to set this template as default.");
    }
  }

  async function handleDuplicate(template) {
    try {
      await onboardingApi.duplicateTemplate(template.id);
      toast.success("Template duplicated.");
      load();
    } catch (err) {
      toast.error(err.message || "Unable to duplicate template.");
    }
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Onboarding Templates</h1>
          <p className="mt-1 text-sm text-slate-500">Reusable checklists used to start a new client onboarding.</p>
        </div>
        <button type="button" onClick={openCreate}
          className="w-fit rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
          + New Template
        </button>
      </div>

      {isLoading ? (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <p className="text-sm font-medium text-slate-500">No templates yet.</p>
          <p className="mt-1 text-xs text-slate-400">Create one to start onboarding clients with a consistent checklist.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900">{t.name}</h3>
                  {t.is_default && (
                    <span className="mt-1 inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Default</span>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  {t.steps.length} step{t.steps.length === 1 ? "" : "s"}
                </span>
              </div>
              {t.description && <p className="mt-2 line-clamp-2 text-sm text-slate-500">{t.description}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => openEdit(t)}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Edit
                </button>
                <button type="button" onClick={() => handleDuplicate(t)}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t)}
                  disabled={t.is_default}
                  title={t.is_default ? "Set another template as default first" : undefined}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                >
                  Delete
                </button>
                {!t.is_default && (
                  <button type="button" onClick={() => handleSetDefault(t)}
                    className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">
                    Set as default
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">{editingId ? "Edit Template" : "New Template"}</h2>
              <button type="button" onClick={closeModal}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            {formError && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300" />
                Use as default template
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">Steps</label>
                  <button type="button" onClick={addStep} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                    + Add step
                  </button>
                </div>
                <div className="space-y-2">
                  {form.steps.map((step, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs font-semibold text-slate-400">{i + 1}.</span>
                        <input
                          value={step.title}
                          onChange={(e) => updateStep(i, { title: e.target.value })}
                          placeholder="Step title"
                          className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                        />
                        <Select value={step.step_type} onChange={(e) => updateStep(i, { step_type: e.target.value })}
                          className="w-44 shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">
                          {STEP_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                        <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600" title="Required">
                          <input type="checkbox" checked={step.is_required} onChange={(e) => updateStep(i, { is_required: e.target.checked })}
                            className="h-3.5 w-3.5 rounded border-slate-300" />
                          Req.
                        </label>
                        <button type="button" onClick={() => removeStep(i)}
                          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">✕</button>
                      </div>

                      {FORM_STEP_TYPES.has(step.step_type) && (
                        <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase text-slate-400">
                              {step.step_type === "questionnaire" ? "Questions" : "Fields"}
                            </span>
                            <button type="button" onClick={() => addField(i)} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                              + Add field
                            </button>
                          </div>
                          {step.form_fields.map((field, j) => (
                            <div key={j} className="rounded-lg bg-slate-50 p-2">
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={field.label}
                                  onChange={(e) => updateField(i, j, { label: e.target.value })}
                                  placeholder="Label"
                                  className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                                />
                                <Select value={field.field_type} onChange={(e) => updateField(i, j, { field_type: e.target.value })}
                                  className="w-32 shrink-0 rounded-md border border-slate-300 px-2 py-1 text-[11px]">
                                  {FIELD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </Select>
                                <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600" title="Required">
                                  <input type="checkbox" checked={field.is_required} onChange={(e) => updateField(i, j, { is_required: e.target.checked })}
                                    className="h-3 w-3 rounded border-slate-300" />
                                  Req.
                                </label>
                                <button type="button" onClick={() => moveField(i, j, -1)} disabled={j === 0}
                                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30">↑</button>
                                <button type="button" onClick={() => moveField(i, j, 1)} disabled={j === step.form_fields.length - 1}
                                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30">↓</button>
                                <button type="button" onClick={() => removeField(i, j)}
                                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600">✕</button>
                              </div>
                              {FIELD_TYPES_WITH_OPTIONS.has(field.field_type) && (
                                <input
                                  value={(field.options_json || []).join(", ")}
                                  onChange={(e) => updateField(i, j, { options_json: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                                  placeholder="Options, comma separated"
                                  className="mt-1.5 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                                />
                              )}
                            </div>
                          ))}
                          {step.form_fields.length === 0 && (
                            <p className="text-xs text-slate-400">No fields yet — add at least one.</p>
                          )}
                        </div>
                      )}

                      {step.step_type === "document_upload" && (
                        <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase text-slate-400">Documents required</span>
                            <button type="button" onClick={() => addRequirement(i)} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                              + Add document
                            </button>
                          </div>
                          {step.document_requirements.map((req, j) => (
                            <div key={j} className="flex items-center gap-1.5 rounded-lg bg-slate-50 p-2">
                              <input
                                value={req.name}
                                onChange={(e) => updateRequirement(i, j, { name: e.target.value })}
                                placeholder="Document name"
                                className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                              />
                              <input
                                value={req.allowed_file_types}
                                onChange={(e) => updateRequirement(i, j, { allowed_file_types: e.target.value })}
                                placeholder="pdf,docx (blank = any)"
                                className="w-40 shrink-0 rounded-md border border-slate-300 px-2 py-1 text-[11px]"
                              />
                              <input
                                type="number" min={1} max={100}
                                value={req.max_file_size_mb}
                                onChange={(e) => updateRequirement(i, j, { max_file_size_mb: Number(e.target.value) || 10 })}
                                title="Max size (MB)"
                                className="w-14 shrink-0 rounded-md border border-slate-300 px-2 py-1 text-[11px]"
                              />
                              <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600" title="Required">
                                <input type="checkbox" checked={req.is_required} onChange={(e) => updateRequirement(i, j, { is_required: e.target.checked })}
                                  className="h-3 w-3 rounded border-slate-300" />
                                Req.
                              </label>
                              <button type="button" onClick={() => removeRequirement(i, j)}
                                className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600">✕</button>
                            </div>
                          ))}
                          {step.document_requirements.length === 0 && (
                            <p className="text-xs text-slate-400">No document requirements yet — add at least one.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={isSaving}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {isSaving ? "Saving…" : editingId ? "Save Changes" : "Create Template"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
