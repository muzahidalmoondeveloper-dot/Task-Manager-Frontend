import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import Select from "../components/Select";
import { onboardingApi } from "../api/onboardingApi";
import { resolveMediaUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { STATUS_BADGE, formatStatusLabel } from "./ClientOnboardingsPage";

const FORM_STEP_TYPES = new Set(["information_form", "questionnaire"]);
const REVIEWABLE_STATUSES = new Set(["submitted", "under_review"]);

const STEP_STATUS_OPTIONS = [
  { value: "not_started",       label: "Not Started" },
  { value: "in_progress",       label: "In Progress" },
  { value: "submitted",         label: "Submitted" },
  { value: "under_review",      label: "Under Review" },
  { value: "changes_requested", label: "Changes Requested" },
  { value: "approved",          label: "Approved" },
  { value: "completed",         label: "Completed" },
  { value: "skipped",           label: "Skipped" },
];

const ONBOARDING_TERMINAL_STATUSES = new Set(["completed", "rejected", "cancelled", "archived"]);

export default function OnboardingDetailPage() {
  const { onboardingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const isAdmin = user?.role === "owner" || user?.role === "admin" || user?.is_org_admin;
  const isProjectManager = user?.role === "project_manager" || user?.is_project_manager;
  const canAccess = isAdmin || isProjectManager;

  const [record, setRecord] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingStepId, setSavingStepId] = useState(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState(null);
  const [changeReason, setChangeReason] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewingDocId, setReviewingDocId] = useState(null);

  useEffect(() => {
    if (!canAccess) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingId, canAccess]);

  async function load() {
    setIsLoading(true);
    setError("");
    try {
      const data = await onboardingApi.get(onboardingId);
      setRecord(data);
    } catch (err) {
      setError(err.message || "Unable to load this onboarding record.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStart() {
    try {
      const updated = await onboardingApi.start(onboardingId);
      setRecord(updated);
      toast.success("Onboarding started.");
    } catch (err) {
      toast.error(err.message || "Unable to start onboarding.");
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      message: "Remove this onboarding record? This permanently deletes its steps, responses, and documents.",
      tone: "danger",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await onboardingApi.remove(onboardingId);
      toast.success("Onboarding record removed.");
      navigate("/onboarding", { replace: true });
    } catch (err) {
      toast.error(err.message || "Unable to remove this onboarding record.");
    }
  }

  async function handleStatusChange(status, confirmMessage) {
    if (confirmMessage && !(await confirm({ message: confirmMessage, tone: "danger", confirmLabel: "Confirm" }))) return;
    setSavingStatus(true);
    try {
      const updated = await onboardingApi.update(onboardingId, { status });
      setRecord(updated);
      toast.success("Status updated.");
    } catch (err) {
      toast.error(err.message || "Unable to update status.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleStepStatusChange(step, status) {
    setSavingStepId(step.id);
    try {
      await onboardingApi.updateStep(onboardingId, step.id, { status });
      // Re-fetch rather than patch client-side — the onboarding's own status
      // (and not just progress_percentage) is now derived server-side from
      // step statuses, so only the backend response is authoritative.
      await load();
      toast.success("Step updated.");
    } catch (err) {
      toast.error(err.message || "Unable to update step.");
    } finally {
      setSavingStepId(null);
    }
  }

  async function handleApprove(step) {
    setSavingStepId(step.id);
    try {
      await onboardingApi.approveStep(onboardingId, step.id, reviewComment.trim() || undefined);
      await load();
      setReviewComment("");
      toast.success("Step approved.");
    } catch (err) {
      toast.error(err.message || "Unable to approve this step.");
    } finally {
      setSavingStepId(null);
    }
  }

  async function handleRequestChanges(step) {
    if (!changeReason.trim()) {
      toast.error("Add a reason for the change request.");
      return;
    }
    setSavingStepId(step.id);
    try {
      await onboardingApi.requestStepChanges(onboardingId, step.id, changeReason.trim());
      await load();
      setChangeReason("");
      toast.success("Changes requested.");
    } catch (err) {
      toast.error(err.message || "Unable to request changes.");
    } finally {
      setSavingStepId(null);
    }
  }

  async function handleReviewDocument(doc, status) {
    setReviewingDocId(doc.id);
    try {
      await onboardingApi.reviewDocument(doc.id, { status, review_comment: reviewComment.trim() || undefined });
      const fresh = await onboardingApi.get(onboardingId);
      setRecord(fresh);
      toast.success(status === "approved" ? "Document approved." : "Document rejected.");
    } catch (err) {
      toast.error(err.message || "Unable to review this document.");
    } finally {
      setReviewingDocId(null);
    }
  }

  if (!canAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  if (isLoading) {
    return <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading...</div>;
  }

  if (error || !record) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error || "Not found."}</div>;
  }

  return (
    <div className="w-full">
      <div className="mb-1 text-sm text-slate-400">
        <Link to="/onboarding" className="hover:text-slate-700 hover:underline">Client Onboarding</Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-600">{record.client?.full_name || record.client?.email}</span>
      </div>

      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{record.client?.full_name || record.client?.email}</h1>
          <p className="mt-1 text-sm text-slate-500">{record.project?.name} · Project Manager: {record.project_manager?.full_name || "Unassigned"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${STATUS_BADGE[record.status] || STATUS_BADGE.draft}`}>
            {formatStatusLabel(record.status)}
          </span>

          {record.status === "draft" && (
            <button type="button" onClick={handleStart} disabled={savingStatus}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              Start Onboarding
            </button>
          )}

          {isAdmin && !ONBOARDING_TERMINAL_STATUSES.has(record.status) && (
            <>
              {record.status === "ready_for_approval" && (
                <button type="button" disabled={savingStatus}
                  onClick={() => handleStatusChange("completed")}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                  Approve Onboarding
                </button>
              )}
              <button type="button" disabled={savingStatus}
                onClick={() => handleStatusChange("rejected", "Reject this client's onboarding? This can't be easily undone.")}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
                Reject
              </button>
              <button type="button" disabled={savingStatus}
                onClick={() => handleStatusChange("cancelled", "Cancel this onboarding?")}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                Cancel
              </button>
            </>
          )}

          {isAdmin && ONBOARDING_TERMINAL_STATUSES.has(record.status) && record.status !== "archived" && (
            <button type="button" disabled={savingStatus}
              onClick={() => handleStatusChange("archived")}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              Archive
            </button>
          )}

          {isAdmin && (
            <button type="button" onClick={handleDelete}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
              Remove
            </button>
          )}
        </div>
      </div>

      {record.progress_percentage < 100 && record.status === "ready_for_approval" && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
          This record shows "Ready for Approval" but progress is below 100% — refresh to re-sync, or flag it via the onboarding audit if it persists.
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-slate-700">Progress</span>
          <span className="text-slate-500">{record.progress_percentage}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="brand-fill h-full rounded-full bg-slate-900 transition-all" style={{ width: `${record.progress_percentage}%` }} />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Checklist</h2>
        </div>
        {record.steps.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No steps on this onboarding.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {record.steps.map((step) => {
              const isExpanded = expandedStepId === step.id;
              const isReviewable = REVIEWABLE_STATUSES.has(step.status);
              const isSaving = savingStepId === step.id;
              return (
                <div key={step.id} className="px-5 py-4">
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        {step.title}
                        {step.is_required && <span className="text-[10px] font-semibold uppercase text-slate-400">Required</span>}
                      </p>
                      {step.description && <p className="mt-0.5 text-xs text-slate-500">{step.description}</p>}
                      <p className="mt-1 text-xs capitalize text-slate-400">{step.step_type.replace(/_/g, " ")}</p>
                    </div>
                    <button type="button" onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                      className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      {isExpanded ? "Hide" : "View"}
                    </button>
                    <Select
                      value={step.status}
                      onChange={(e) => handleStepStatusChange(step, e.target.value)}
                      disabled={isSaving}
                      className="w-44 shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    >
                      {STEP_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>

                  {isExpanded && (
                    <div className="mt-3.5 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      {FORM_STEP_TYPES.has(step.step_type) && (
                        <div className="space-y-2.5">
                          {step.form_fields.length === 0 ? (
                            <p className="text-xs text-slate-400">No fields configured.</p>
                          ) : (
                            step.form_fields.map((f) => (
                              <div key={f.id}>
                                <p className="text-xs font-semibold text-slate-500">{f.label}</p>
                                <p className="mt-0.5 text-sm text-slate-800">
                                  {f.response
                                    ? (f.response.response_json?.length
                                        ? f.response.response_json.join(", ")
                                        : f.response.response_text || "—")
                                    : <span className="text-slate-400">No response yet</span>}
                                </p>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {step.step_type === "document_upload" && (
                        <div className="space-y-3">
                          {(step.document_requirements.length ? step.document_requirements : [{ id: "free", name: "Documents", documents: step.documents || [] }]).map((req) => (
                            <div key={req.id ?? "free"}>
                              <p className="text-xs font-semibold text-slate-500">{req.name}</p>
                              {(req.documents || []).filter((d) => d.status !== "replaced").length === 0 ? (
                                <p className="mt-0.5 text-xs text-slate-400">No document uploaded yet.</p>
                              ) : (
                                <ul className="mt-1 space-y-1.5">
                                  {req.documents.filter((d) => d.status !== "replaced").map((d) => (
                                    <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs">
                                      <a href={resolveMediaUrl(d.file_url)} target="_blank" rel="noreferrer" className="truncate text-slate-700 hover:underline">
                                        {d.file_name} (v{d.version})
                                      </a>
                                      <span className="shrink-0 capitalize text-slate-400">{d.status}</span>
                                      {d.status === "uploaded" || d.status === "under_review" ? (
                                        <div className="flex shrink-0 gap-1.5">
                                          <button type="button" disabled={reviewingDocId === d.id} onClick={() => handleReviewDocument(d, "approved")}
                                            className="rounded-md bg-emerald-100 px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-60">
                                            Approve
                                          </button>
                                          <button type="button" disabled={reviewingDocId === d.id} onClick={() => handleReviewDocument(d, "rejected")}
                                            className="rounded-md bg-red-100 px-2 py-1 font-semibold text-red-700 hover:bg-red-200 disabled:opacity-60">
                                            Reject
                                          </button>
                                        </div>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {step.change_requests?.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-slate-500">Change requests</p>
                          {step.change_requests.map((c) => (
                            <p key={c.id} className="rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-600">
                              <span className={`mr-1.5 font-semibold ${c.status === "open" ? "text-orange-600" : "text-slate-400"}`}>[{c.status}]</span>
                              {c.reason}
                            </p>
                          ))}
                        </div>
                      )}

                      {isReviewable && (
                        <div className="space-y-2 border-t border-slate-200 pt-3">
                          <input
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder="Review comment (optional, client-visible)"
                            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                          />
                          <textarea
                            value={changeReason}
                            onChange={(e) => setChangeReason(e.target.value)}
                            placeholder="Reason for requesting changes (required to request changes)"
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                          />
                          <div className="flex gap-2">
                            <button type="button" disabled={isSaving} onClick={() => handleApprove(step)}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                              Approve Step
                            </button>
                            <button type="button" disabled={isSaving} onClick={() => handleRequestChanges(step)}
                              className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
                              Request Changes
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
