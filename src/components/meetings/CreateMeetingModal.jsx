import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import DatePicker from "../DatePicker";
import Select from "../Select";
import { meetingApi } from "../../api/meetingApi";
import { meetingTemplateApi } from "../../api/meetingTemplateApi";
import { projectApi } from "../../api/projectApi";
import { userApi } from "../../api/userApi";
import { Avatar } from "./meetingHelpers";
import { AVATAR_COLORS, MEETING_TYPES, fmtDuration, getInitials } from "./meetingConstants";

// ─── Smart Meeting System — Create Meeting (plan section 3) ───────────────────
//
// Three-zone layout: Setup (left) / Agenda Builder (center) / Smart Summary
// (right). MVP scope only (plan section 17) — no AI Suggestions, Meeting
// Health Score, Smart Scheduling, or Expected Outcomes; those are Phase 2
// (section 18). Editing an existing meeting shows Setup fields only —
// agenda/notes/decisions for an already-created meeting are managed from
// the Live Meeting view (LiveMeetingPanel), which already has full CRUD for
// them; MeetingUpdate has no agenda field, so an edit-mode agenda builder
// here would silently fail to persist.

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private (organizer + invitees only)" },
  { value: "team", label: "Team" },
  { value: "organization", label: "Organization" },
];

const RECURRENCE_OPTIONS = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

let localIdCounter = 0;
function nextLocalId() {
  localIdCounter += 1;
  return `local-${localIdCounter}`;
}

function toLocalDateParts(isoStr) {
  if (!isoStr) return { date: "", time: "" };
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// ─── Local (pre-save) agenda list — same native drag-and-drop mechanics as
// MeetingsTab's live-meeting AgendaList, adapted for unsaved local rows. ──

function LocalAgendaRow({ section, onUpdate, onDelete, onDragStart, onDragEnter, onDrop }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
    >
      <svg className="h-4 w-4 shrink-0 cursor-grab text-slate-300" viewBox="0 0 20 20" fill="currentColor">
        <path d="M7 2a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM7 8a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zm-6 6a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4z" />
      </svg>
      <input
        value={section.title}
        onChange={(e) => onUpdate({ ...section, title: e.target.value })}
        placeholder="Section title"
        className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
      />
      <input
        type="number"
        min="0"
        value={section.duration_minutes ?? ""}
        onChange={(e) => onUpdate({ ...section, duration_minutes: e.target.value ? Number(e.target.value) : null })}
        placeholder="min"
        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
      />
      <button type="button" onClick={onDelete} className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-500">
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zm-1 7a1 1 0 012 0v4a1 1 0 11-2 0V9zm4 0a1 1 0 012 0v4a1 1 0 11-2 0V9z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}

export default function CreateMeetingModal({ team, teamMembers, teams, meeting, onSave, onClose }) {
  const isEdit = Boolean(meeting);
  const dateParts = toLocalDateParts(meeting?.scheduled_at);

  // Team-locked (opened from a team's own Meetings tab): `team`/`teamMembers`
  // are fixed. Team-selectable (opened from the org-wide Meetings page):
  // `teams` is a list the user can optionally pick from — meetings are NOT
  // team-specific, so "no team" (org-wide) is the default, not the first team.
  const [selectedTeamId, setSelectedTeamId] = useState(
    team?.id ? String(team.id) : (meeting?.team_id ? String(meeting.team_id) : "")
  );
  const activeTeam = team || teams?.find((t) => String(t.id) === selectedTeamId) || null;
  const [orgUsers, setOrgUsers] = useState([]);
  // No team picked → meetings aren't team-specific, so fall back to every
  // org member as the Owner/Attendees pool instead of leaving it empty.
  const activeTeamMembers = team ? teamMembers : (activeTeam?.members || orgUsers);

  const [title, setTitle] = useState(meeting?.title || "");
  const [meetingType, setMeetingType] = useState(meeting?.meeting_type || "custom");
  const [objective, setObjective] = useState(meeting?.objective || "");
  const [description, setDescription] = useState(meeting?.description || "");
  const [dateStr, setDateStr] = useState(dateParts.date);
  const [timeStr, setTimeStr] = useState(dateParts.time || "09:00");
  const [durationMinutes, setDurationMinutes] = useState(String(meeting?.duration_minutes || 60));
  const [recurrence, setRecurrence] = useState(meeting?.recurrence || "none");
  const [priority, setPriority] = useState(meeting?.priority || "medium");
  const [visibility, setVisibility] = useState(meeting?.visibility || (team ? "team" : "organization"));
  const [location, setLocation] = useState(meeting?.location || "");
  const [projectId, setProjectId] = useState(meeting?.project_id ? String(meeting.project_id) : "");
  const [organizerId, setOrganizerId] = useState(meeting?.organizer_id ? String(meeting.organizer_id) : "");
  const [participantIds, setParticipantIds] = useState(
    meeting ? meeting.participants.map((p) => p.user_id).filter(Boolean) : []
  );
  const [saving, setSaving] = useState(false);

  // ── Agenda Builder (create only) ──
  const [agendaSections, setAgendaSections] = useState([]);
  const [agendaTouched, setAgendaTouched] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [linkedTasks, setLinkedTasks] = useState([]);
  const [suggested, setSuggested] = useState({ overdue: [], high_priority: [], unresolved_issues: [] });
  const [projects, setProjects] = useState([]);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  useEffect(() => {
    projectApi.list().then(setProjects).catch(() => {});
    if (!isEdit) {
      meetingTemplateApi.list().then(setTemplates).catch(() => {});
    }
    if (!team) {
      userApi.list().then(setOrgUsers).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Meeting type → default agenda (static lookup, matches a saved
  // MeetingTemplate for that type) — only for a fresh create, and only
  // until the user manually edits the agenda themselves.
  useEffect(() => {
    if (isEdit || agendaTouched || templates.length === 0) return;
    const match = templates.find((t) => t.meeting_type === meetingType);
    if (match) {
      setAgendaSections(match.agenda_sections.map((s) => ({ id: nextLocalId(), title: s.title, duration_minutes: s.duration_minutes })));
      if (!meeting) setDurationMinutes(String(match.default_duration_minutes));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingType, templates, agendaTouched]);

  useEffect(() => {
    // No team selected → org-wide suggestions (suggestedTasks omits
    // team_id from the query entirely); meetings aren't team-specific, so
    // this still runs even without a team picked.
    if (isEdit) return;
    meetingApi.suggestedTasks(activeTeam?.id, projectId ? Number(projectId) : undefined)
      .then(setSuggested)
      .catch(() => {});
  }, [activeTeam?.id, projectId, isEdit]);

  function updateSection(updated) {
    setAgendaTouched(true);
    setAgendaSections((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function deleteSection(id) {
    setAgendaTouched(true);
    setAgendaSections((prev) => prev.filter((s) => s.id !== id));
  }

  function addSection(title = "") {
    setAgendaTouched(true);
    setAgendaSections((prev) => [...prev, { id: nextLocalId(), title, duration_minutes: null }]);
  }

  function handleDrop() {
    const from = dragItem.current;
    const to = dragOver.current;
    dragItem.current = null;
    dragOver.current = null;
    if (from === null || to === null || from === to) return;
    setAgendaTouched(true);
    setAgendaSections((prev) => {
      const reordered = [...prev];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      return reordered;
    });
  }

  function toggleParticipant(uid) {
    setParticipantIds((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  }

  function addLinkedTask(task) {
    setLinkedTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
  }

  function removeLinkedTask(taskId) {
    setLinkedTasks((prev) => prev.filter((t) => t.id !== taskId));
  }

  function addAllOverdue() {
    setLinkedTasks((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      const toAdd = suggested.overdue.filter((t) => !existingIds.has(t.id));
      return [...prev, ...toAdd];
    });
  }

  const totalAgendaMinutes = useMemo(
    () => agendaSections.reduce((sum, s) => sum + (Number(s.duration_minutes) || 0), 0),
    [agendaSections]
  );

  async function handleSaveAsTemplate() {
    if (!templateName.trim()) {
      toast.error("Give the template a name.");
      return;
    }
    try {
      await meetingTemplateApi.create({
        name: templateName.trim(),
        meeting_type: meetingType,
        default_duration_minutes: Number(durationMinutes) || 60,
        agenda_sections: agendaSections.map((s) => ({ title: s.title, duration_minutes: s.duration_minutes })),
      });
      toast.success("Template saved.");
      setSaveAsTemplate(false);
      setTemplateName("");
    } catch (err) {
      toast.error(err.message || "Unable to save template.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !dateStr || !timeStr) {
      toast.error("Title, date, and time are required.");
      return;
    }
    const validSections = agendaSections.filter((s) => s.title.trim());
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        objective: objective.trim() || null,
        scheduled_at: new Date(`${dateStr}T${timeStr}`).toISOString(),
        duration_minutes: Number(durationMinutes) || 60,
        meeting_type: meetingType,
        priority,
        visibility,
        recurrence,
        location: location.trim() || null,
        team_id: activeTeam?.id ?? null,
        project_id: projectId ? Number(projectId) : null,
        organizer_id: organizerId ? Number(organizerId) : null,
        participant_ids: participantIds,
      };
      if (!isEdit) {
        payload.agenda_items = validSections.map((s, i) => ({
          title: s.title.trim(), duration_minutes: s.duration_minutes || null, sort_order: i,
        }));
        payload.linked_task_ids = linkedTasks.map((t) => t.id);
      }
      await onSave(payload);
      onClose();
    } catch {
      // onSave already toasts its own failure
    } finally {
      setSaving(false);
    }
  }

  const attendeeCount = participantIds.length;
  const linkedTaskCount = linkedTasks.length + (isEdit ? meeting.meeting_tasks.length : 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{isEdit ? "Edit Meeting" : "Create Meeting"}</h2>
            {!isEdit && <p className="text-xs text-slate-500">Set up the meeting, build the agenda, and review before you create it.</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className={`grid flex-1 gap-0 overflow-y-auto ${isEdit ? "grid-cols-1" : "lg:grid-cols-[1.1fr_1.3fr_0.8fr]"}`}>
            {/* ── Left: Meeting Setup ── */}
            <div className="space-y-4 border-b border-slate-200 p-6 lg:border-b-0 lg:border-r">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Meeting Setup</p>

              {!team && teams && teams.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Team (optional)</label>
                  <Select value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)} className="w-full px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-500">
                    <option value="">No team — org-wide meeting</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Meeting Title *</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Weekly Team Sync"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Meeting Type</label>
                <Select value={meetingType} onChange={(e) => setMeetingType(e.target.value)} className="w-full px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-500">
                  {MEETING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Objective</label>
                <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should this meeting accomplish?"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional details"
                  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Date *</label>
                  <DatePicker value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Time *</label>
                  <input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} required
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Duration (min)</label>
                  <input type="number" min="5" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Recurrence</label>
                  <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="w-full px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-500">
                    {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Meeting Owner</label>
                <Select value={organizerId} onChange={(e) => setOrganizerId(e.target.value)} className="w-full px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-500">
                  <option value="">Unassigned</option>
                  {activeTeamMembers.map((m) => {
                    const uid = m.user?.id || m.id;
                    const name = m.user?.full_name || m.full_name || m.email;
                    return <option key={uid} value={uid}>{name}</option>;
                  })}
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Linked Project</label>
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-500">
                  <option value="">No project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Priority</label>
                  <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-500">
                    {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Visibility</label>
                  <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="w-full px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-500">
                    {VISIBILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Location / Meeting Link</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room name or https://…"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>

              {activeTeamMembers.length > 0 && (
                <div>
                  <label className="mb-2 block text-xs font-medium text-slate-500">Attendees</label>
                  <div className="flex flex-wrap gap-2">
                    {activeTeamMembers.map((m) => {
                      const uid = m.user?.id || m.id;
                      const name = m.user?.full_name || m.full_name || m.email || "?";
                      const selected = participantIds.includes(uid);
                      return (
                        <button key={uid} type="button" onClick={() => toggleParticipant(uid)}
                          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                            selected ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
                          }`}>
                          <Avatar name={name} size="h-4 w-4" />
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Center: Agenda Builder (create only) ── */}
            {!isEdit && (
              <div className="space-y-5 border-b border-slate-200 p-6 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Agenda Builder</p>
                  <button type="button" onClick={() => setSaveAsTemplate((v) => !v)} className="text-xs font-medium text-teal-600 hover:underline">
                    Save as template
                  </button>
                </div>

                {saveAsTemplate && (
                  <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 p-2">
                    <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name"
                      className="flex-1 rounded-lg border border-teal-300 px-2 py-1.5 text-sm focus:outline-none" />
                    <button type="button" onClick={handleSaveAsTemplate} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700">Save</button>
                  </div>
                )}

                <div className="space-y-2">
                  {agendaSections.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                      No agenda sections yet. Add one below, or pick a Meeting Type above for a starting agenda.
                    </p>
                  ) : (
                    agendaSections.map((section, idx) => (
                      <LocalAgendaRow
                        key={section.id}
                        section={section}
                        onUpdate={updateSection}
                        onDelete={() => deleteSection(section.id)}
                        onDragStart={() => { dragItem.current = idx; }}
                        onDragEnter={() => { dragOver.current = idx; }}
                        onDrop={handleDrop}
                      />
                    ))
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => addSection("")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    + Add Section
                  </button>
                  <button type="button" onClick={() => addSection("Task Review")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    + Task Block
                  </button>
                  <button type="button" onClick={() => addSection("Decisions")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    + Decision Block
                  </button>
                  <button type="button" onClick={() => addSection("Notes")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    + Notes Block
                  </button>
                </div>

                {/* Linked Task Integration (plan section 7) */}
                {(suggested.overdue.length > 0 || suggested.high_priority.length > 0 || suggested.unresolved_issues.length > 0) && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-amber-800">
                        {suggested.overdue.length > 0
                          ? `${suggested.overdue.length} task${suggested.overdue.length === 1 ? "" : "s"} overdue. Add to the agenda?`
                          : "Relevant work for this meeting"}
                      </p>
                      {suggested.overdue.length > 0 && (
                        <button type="button" onClick={addAllOverdue} className="text-xs font-semibold text-amber-700 hover:underline">Add all</button>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {[...suggested.overdue, ...suggested.high_priority].map((t) => (
                        <div key={t.id} className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-xs">
                          <span className="truncate text-slate-700">{t.name}</span>
                          <button type="button" onClick={() => addLinkedTask(t)}
                            disabled={linkedTasks.some((lt) => lt.id === t.id)}
                            className="shrink-0 font-semibold text-teal-600 hover:underline disabled:text-slate-300">
                            {linkedTasks.some((lt) => lt.id === t.id) ? "Added" : "+ Add"}
                          </button>
                        </div>
                      ))}
                      {suggested.unresolved_issues.map((i) => (
                        <div key={`issue-${i.id}`} className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-xs">
                          <span className="truncate text-slate-700">⚠ {i.title}</span>
                          <span className="shrink-0 text-slate-400">Unresolved issue</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {linkedTasks.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-slate-500">Linked tasks ({linkedTasks.length})</p>
                    <div className="flex flex-wrap gap-1.5">
                      {linkedTasks.map((t) => (
                        <span key={t.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                          {t.name}
                          <button type="button" onClick={() => removeLinkedTask(t.id)} className="text-slate-400 hover:text-red-500">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Right: Smart Summary / Preview ── */}
            {!isEdit && (
              <div className="space-y-4 p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Smart Summary</p>
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <SummaryRow label="Total Duration" value={fmtDuration(totalAgendaMinutes || Number(durationMinutes) || 0) || "—"} />
                  <SummaryRow label="Agenda Items" value={agendaSections.filter((s) => s.title.trim()).length} />
                  <SummaryRow label="Attendees" value={attendeeCount} />
                  <SummaryRow label="Linked Tasks" value={linkedTaskCount} />
                  <SummaryRow label="Recurrence" value={RECURRENCE_OPTIONS.find((o) => o.value === recurrence)?.label} />
                </div>

                {attendeeCount > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {participantIds.slice(0, 8).map((uid) => {
                      const m = activeTeamMembers.find((mm) => (mm.user?.id || mm.id) === uid);
                      const name = m ? (m.user?.full_name || m.full_name || m.email) : "?";
                      const idx = name.charCodeAt(0) % AVATAR_COLORS.length;
                      return (
                        <span key={uid} title={name} className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white ${AVATAR_COLORS[idx]}`}>
                          {getInitials(name)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60">
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Meeting"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value ?? "—"}</span>
    </div>
  );
}
