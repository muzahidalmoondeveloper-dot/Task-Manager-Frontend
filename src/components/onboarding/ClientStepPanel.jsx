import { useState } from "react";
import toast from "react-hot-toast";

import Select from "../Select";
import { onboardingApi } from "../../api/onboardingApi";
import { resolveMediaUrl } from "../../api/client";

const EDITABLE_STATUSES = new Set(["not_started", "in_progress", "changes_requested"]);

function fieldValue(field) {
  const r = field.response;
  if (!r) return field.field_type === "multi_select" ? [] : "";
  if (field.field_type === "multi_select") return r.response_json || [];
  if (field.field_type === "checkbox") return Boolean(r.response_json?.[0]);
  return r.response_text || "";
}

function FieldInput({ field, value, onChange, disabled }) {
  const base = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500";
  switch (field.field_type) {
    case "long_text":
      return <textarea rows={3} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={base} />;
    case "dropdown":
      return (
        <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${base} !bg-white`}>
          <option value="">Select…</option>
          {(field.options_json || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    case "multi_select":
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options_json || []).map((o) => {
            const checked = value.includes(o);
            return (
              <label key={o} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${checked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600"}`}>
                <input
                  type="checkbox" checked={checked} disabled={disabled}
                  onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((v) => v !== o))}
                  className="hidden"
                />
                {o}
              </label>
            );
          })}
        </div>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          {field.placeholder || "Yes"}
        </label>
      );
    case "number":
      return <input type="number" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className={base} />;
    case "date":
      return <input type="date" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={base} />;
    case "email":
      return <input type="email" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className={base} />;
    case "url":
      return <input type="url" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className={base} />;
    case "phone":
      return <input type="tel" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className={base} />;
    default:
      return <input type="text" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className={base} />;
  }
}

function toResponseItem(field, value) {
  if (field.field_type === "multi_select") return { field_id: field.id, response_text: null, response_json: value };
  if (field.field_type === "checkbox") return { field_id: field.id, response_text: null, response_json: value ? [true] : [] };
  return { field_id: field.id, response_text: String(value ?? ""), response_json: null };
}

export function FormStepPanel({ step, onboardingId, onStepUpdated }) {
  const editable = EDITABLE_STATUSES.has(step.status);
  const [values, setValues] = useState(() => {
    const map = {};
    for (const f of step.form_fields) map[f.id] = fieldValue(f);
    return map;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState({});

  function setValue(fieldId, v) {
    setValues((cur) => ({ ...cur, [fieldId]: v }));
  }

  async function handleSave(submit) {
    if (submit) {
      const missing = {};
      for (const f of step.form_fields) {
        if (!f.is_required) continue;
        const v = values[f.id];
        const empty = f.field_type === "multi_select" ? !v?.length : f.field_type === "checkbox" ? false : !String(v || "").trim();
        if (empty) missing[f.id] = `"${f.label}" is required.`;
      }
      if (Object.keys(missing).length) {
        setErrors(missing);
        toast.error("Fill in the required fields before submitting.");
        return;
      }
    }
    setErrors({});
    setIsSaving(true);
    try {
      const responses = step.form_fields.map((f) => toResponseItem(f, values[f.id]));
      const updated = await onboardingApi.saveStepResponses(onboardingId, step.id, { responses, submit });
      onStepUpdated(updated);
      toast.success(submit ? "Submitted for review." : "Draft saved.");
    } catch (err) {
      toast.error(err.message || "Unable to save your responses.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-slate-100 pt-3.5">
      {step.form_fields.map((field) => (
        <div key={field.id}>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            {field.label}
            {field.is_required && <span className="ml-1 text-red-500">*</span>}
          </label>
          {field.help_text && <p className="mb-1 text-xs text-slate-400">{field.help_text}</p>}
          <FieldInput field={field} value={values[field.id]} disabled={!editable} onChange={(v) => setValue(field.id, v)} />
          {errors[field.id] && <p className="mt-1 text-xs text-red-600">{errors[field.id]}</p>}
        </div>
      ))}
      {step.form_fields.length === 0 && <p className="text-sm text-slate-400">No fields configured for this step yet.</p>}

      {editable && (
        <div className="flex gap-2 pt-1">
          <button type="button" disabled={isSaving} onClick={() => handleSave(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            Save Draft
          </button>
          <button type="button" disabled={isSaving} onClick={() => handleSave(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            Submit
          </button>
        </div>
      )}
    </div>
  );
}

export function DocumentStepPanel({ step, onboardingId, onStepUpdated }) {
  const editable = EDITABLE_STATUSES.has(step.status);
  const [uploadingId, setUploadingId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleUpload(requirement, file) {
    if (!file) return;
    setUploadingId(requirement?.id ?? "free");
    try {
      await onboardingApi.uploadStepDocument(onboardingId, step.id, file, requirement?.id);
      const fresh = await onboardingApi.get(onboardingId);
      const freshStep = fresh.steps.find((s) => s.id === step.id);
      onStepUpdated(freshStep || step, fresh);
      toast.success("Document uploaded.");
    } catch (err) {
      toast.error(err.message || "Unable to upload this document.");
    } finally {
      setUploadingId(null);
    }
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    try {
      const updated = await onboardingApi.submitStep(onboardingId, step.id);
      onStepUpdated(updated);
      toast.success("Submitted for review.");
    } catch (err) {
      toast.error(err.message || "Unable to submit this step.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const freeDocs = (step.documents || []).filter((d) => !d.requirement_id);
  const requirements = step.document_requirements.length
    ? step.document_requirements
    : [{ id: null, name: "Document", is_required: false, documents: freeDocs }];

  return (
    <div className="space-y-4 border-t border-slate-100 pt-3.5">
      {requirements.map((req) => {
        const docs = (req.documents || []).filter((d) => d.status !== "replaced");
        const latest = docs[docs.length - 1];
        return (
          <div key={req.id ?? "free"} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">
                {req.name}
                {req.is_required && <span className="ml-1 text-red-500">*</span>}
              </p>
              {latest && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  latest.status === "approved" ? "bg-emerald-100 text-emerald-700"
                  : latest.status === "rejected" ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700"
                }`}>
                  {latest.status}
                </span>
              )}
            </div>
            {req.description && <p className="mt-0.5 text-xs text-slate-400">{req.description}</p>}
            <ul className="mt-2 space-y-1">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-xs text-slate-600">
                  <a href={resolveMediaUrl(d.file_url)} target="_blank" rel="noreferrer" className="truncate hover:underline">
                    {d.file_name} (v{d.version})
                  </a>
                  <span className="shrink-0 text-slate-400">{new Date(d.uploaded_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
            {latest?.review_comment && (
              <p className="mt-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                <span className="font-semibold">Reviewer note:</span> {latest.review_comment}
              </p>
            )}
            {editable && (
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                {uploadingId === (req.id ?? "free") ? "Uploading…" : latest ? "Replace file" : "Upload file"}
                <input type="file" className="hidden" disabled={uploadingId != null}
                  onChange={(e) => handleUpload(req.id ? req : null, e.target.files?.[0])} />
              </label>
            )}
          </div>
        );
      })}

      {editable && (
        <div className="pt-1">
          <button type="button" disabled={isSubmitting} onClick={handleSubmit}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            Submit
          </button>
        </div>
      )}
    </div>
  );
}

export function ChangeRequestNotice({ step }) {
  const open = (step.change_requests || []).filter((c) => c.status === "open");
  if (!open.length) return null;
  return (
    <div className="border-t border-slate-100 pt-3.5">
      {open.map((c) => (
        <div key={c.id} className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
          <span className="font-semibold">Changes requested:</span> {c.reason}
        </div>
      ))}
    </div>
  );
}
