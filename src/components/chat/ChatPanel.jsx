import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { chatApi } from "../../api/chatApi";
import { useAuth } from "../../context/AuthContext";
import { usePageContext } from "../../context/PageContext";

// ─── Accepted file types ──────────────────────────────────────────────────────
const ACCEPTED_TYPES = ".pdf,.docx,.txt,.md,.csv,.json";
const MAX_FILE_MB = 20;

// ─── Markdown renderer ─────────────────────────────────────────────────────────
// A small, dependency-free block-level parser covering what LLM replies
// actually use: headings, bold/italic, inline code, fenced code blocks,
// bulleted/numbered lists, blockquotes, and links. Raw text is HTML-escaped
// before any markdown substitution so the model's own output can never
// inject markup (dangerouslySetInnerHTML only ever sees escaped text plus
// the specific tags we insert ourselves).
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`([^`]+?)`/g, '<code class="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[0.85em] font-mono">$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-600 underline hover:text-indigo-700">$1</a>');
}

const BLOCK_STARTERS = [/^```/, /^#{1,3}\s/, /^[•*-]\s+/, /^\d+[.)]\s+/, /^>\s?/];

function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or run off the end if the model never closed it)
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: quoteLines.join(" ") });
      continue;
    }

    if (/^[•*-]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[•*-]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[•*-]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — swallow following lines until the next blank line or the
    // start of another block type, so a hard-wrapped reply reads as one block.
    const paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !BLOCK_STARTERS.some((re) => re.test(lines[i]))) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: paraLines.join(" ") });
  }

  return blocks.map((block, idx) => {
    switch (block.type) {
      case "code":
        return (
          <pre key={idx} className="bg-slate-900 text-slate-100 text-xs rounded-lg px-3 py-2.5 my-2 overflow-x-auto">
            <code>{block.content}</code>
          </pre>
        );
      case "heading": {
        const sizeClass = block.level === 1 ? "text-base font-bold mt-2 mb-1" : block.level === 2 ? "text-sm font-bold mt-2 mb-1" : "text-sm font-semibold mt-1.5 mb-1";
        return <p key={idx} className={sizeClass} dangerouslySetInnerHTML={{ __html: renderInline(block.text) }} />;
      }
      case "quote":
        return (
          <blockquote key={idx} className="border-l-2 border-slate-300 pl-3 my-1.5 text-slate-500 italic" dangerouslySetInnerHTML={{ __html: renderInline(block.text) }} />
        );
      case "ul":
        return (
          <ul key={idx} className="list-disc pl-5 my-1 space-y-0.5">
            {block.items.map((item, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={idx} className="list-decimal pl-5 my-1 space-y-0.5">
            {block.items.map((item, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
            ))}
          </ol>
        );
      case "p":
      default:
        return <p key={idx} className="mb-1.5 last:mb-0" dangerouslySetInnerHTML={{ __html: renderInline(block.text) }} />;
    }
  });
}

// ─── File attachment badge (inside message bubble) ────────────────────────────
function FileBadge({ filename }) {
  const ext = filename.split(".").pop().toUpperCase();
  const colorMap = {
    PDF: "bg-red-500/20 text-red-300 border-red-500/30",
    DOCX: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    TXT: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    MD: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    CSV: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    JSON: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border font-medium ${colorMap[ext] || "bg-slate-600/20 text-slate-300 border-slate-500/30"}`}>
      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
      </svg>
      {filename}
    </span>
  );
}

// ─── Action pill ──────────────────────────────────────────────────────────────
function ActionPill({ action, onNavigate, onUndo, resolvedUndo }) {
  const handleClick = () => {
    if (action.type === "navigate" && action.payload?.path) onNavigate(action.payload.path);
    if (action.type === "undo_available" && !resolvedUndo) onUndo(action.payload.operation_id);
  };
  const colorMap = {
    task_created: "bg-emerald-50 text-emerald-700 border-emerald-200",
    task_updated: "bg-blue-50 text-blue-700 border-blue-200",
    task_deleted: "bg-red-50 text-red-700 border-red-200",
    navigate: "bg-slate-50 text-slate-700 border-slate-200 cursor-pointer hover:bg-slate-100",
    undo_available: resolvedUndo
      ? "bg-slate-100 text-slate-400 border-slate-200 cursor-default"
      : "bg-amber-50 text-amber-700 border-amber-200 cursor-pointer hover:bg-amber-100",
  };
  return (
    <span onClick={handleClick} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${colorMap[action.type] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
      {action.type === "task_created" && "✓ "}
      {action.type === "task_updated" && "✎ "}
      {action.type === "task_deleted" && "✕ "}
      {action.type === "navigate" && "→ "}
      {action.type === "undo_available" && "↩ "}
      {resolvedUndo ? "Undone" : action.label}
    </span>
  );
}

// ─── Change-set preview card (spec Section 24, 45) ─────────────────────────────
function ChangeSetCard({ action, onConfirm, onCancel, resolved }) {
  const { affected_count: affectedCount, summary } = action.payload || {};
  return (
    <div className="mt-1.5 w-full max-w-[85%] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
      <p className="text-xs font-semibold text-amber-700">Confirmation needed</p>
      <p className="mt-1 text-xs text-slate-700">
        {affectedCount != null && (
          <span className="font-medium">{affectedCount} record{affectedCount === 1 ? "" : "s"}: </span>
        )}
        {summary}
      </p>
      {resolved ? (
        <p className="mt-2 text-xs italic text-slate-400">{resolved === "confirmed" ? "Confirmed." : "Cancelled."}</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            onClick={onConfirm}
            className="rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            Confirm
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg, actions, onNavigate, onConfirmChangeSet, onCancelChangeSet, onUndo, resolvedChangeSets, resolvedUndoOps }) {
  const isUser = msg.role === "user";

  // Detect file badge: message starts with [📎 ...]
  const fileMatch = msg.content.match(/^\[📎\s+(.+?)\]/);
  const filename = fileMatch ? fileMatch[1] : null;
  const textAfterBadge = filename
    ? msg.content.slice(fileMatch[0].length).trim()
    : msg.content;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-xs font-bold text-white mr-2 flex-shrink-0 mt-0.5 shadow-sm">AI</div>
      )}
      <div className={`max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed tracking-[0.01em] ${isUser ? "bg-slate-900 text-white rounded-tr-sm" : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm"}`}>
          {isUser ? (
            <div className="space-y-2">
              {filename && <FileBadge filename={filename} />}
              {textAfterBadge && <p>{textAfterBadge}</p>}
            </div>
          ) : (
            <div>{renderMarkdown(msg.content)}</div>
          )}
        </div>
        {actions && actions.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-1.5 px-1">
            {actions.map((a, idx) => {
              if (a.type === "change_set_preview") {
                const changeSetId = a.payload?.change_set_id;
                return (
                  <ChangeSetCard
                    key={idx}
                    action={a}
                    resolved={resolvedChangeSets?.[changeSetId]}
                    onConfirm={() => onConfirmChangeSet(changeSetId)}
                    onCancel={() => onCancelChangeSet(changeSetId)}
                  />
                );
              }
              return (
                <div key={idx} className="flex flex-wrap gap-1.5">
                  <ActionPill
                    action={a}
                    onNavigate={onNavigate}
                    onUndo={onUndo}
                    resolvedUndo={a.type === "undo_available" && resolvedUndoOps?.has(a.payload?.operation_id)}
                  />
                </div>
              );
            })}
          </div>
        )}
        <span className="text-[11px] tabular-nums text-slate-400 mt-1 px-1">
          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 ml-2 flex-shrink-0 mt-0.5">Me</div>
      )}
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-sm">AI</div>
      <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

// ─── Selected file chip (above the input) ────────────────────────────────────
const FILE_ICON_COLORS = {
  PDF: "bg-rose-100 text-rose-500",
  DOCX: "bg-blue-100 text-blue-500",
  TXT: "bg-slate-200 text-slate-500",
  MD: "bg-purple-100 text-purple-500",
  CSV: "bg-emerald-100 text-emerald-500",
  JSON: "bg-amber-100 text-amber-500",
};

function SelectedFileChip({ file, onRemove }) {
  const ext = file.name.split(".").pop().toUpperCase();
  return (
    <div className="relative mb-2 inline-flex max-w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${FILE_ICON_COLORS[ext] || "bg-slate-100 text-slate-500"}`}>
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <div className="min-w-0 pr-4">
        <p className="text-sm font-medium text-slate-800 truncate">{file.name}</p>
        <p className="text-xs text-slate-400">{ext}</p>
      </div>
      <button
        onClick={onRemove}
        className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-white shadow-sm hover:bg-slate-950 transition-colors"
        title="Remove file"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Session sidebar ──────────────────────────────────────────────────────────
function SessionSidebar({ sessions, currentSessionId, onSelect, onNew, onDelete }) {
  return (
    <div className="w-48 border-r border-slate-200 flex flex-col bg-slate-50 rounded-l-2xl overflow-hidden">
      <div className="p-3 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">History</span>
        <button onClick={onNew} className="text-slate-500 hover:text-slate-800 text-lg leading-none" title="New chat">+</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && <p className="text-xs text-slate-400 p-3">No previous chats</p>}
        {sessions.map((s) => (
          <div key={s.id} onClick={() => onSelect(s.id)} className={`group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-100 transition-colors ${s.id === currentSessionId ? "bg-white border-l-2 border-slate-800" : ""}`}>
            <span className="text-xs text-slate-600 truncate flex-1">{s.title || "New chat"}</span>
            <button onClick={(e) => { e.stopPropagation(); onDelete(s.id); }} className="hidden group-hover:block text-slate-400 hover:text-red-500 ml-1 text-xs" title="Delete">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Approval inbox panel (spec Section 47) ───────────────────────────────────
function ApprovalsPanel({ approvals, onApprove, onReject, busyId }) {
  return (
    <div className="w-56 border-r border-slate-200 flex flex-col bg-slate-50 rounded-l-2xl overflow-hidden">
      <div className="p-3 border-b border-slate-200">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Pending approvals</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {approvals.length === 0 && <p className="text-xs text-slate-400 p-3">Nothing needs your approval right now.</p>}
        {approvals.map((a) => (
          <div key={a.id} className="px-3 py-2.5 border-b border-slate-200">
            <p className="text-xs text-slate-700">{a.reason}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => onApprove(a.id)}
                disabled={busyId === a.id}
                className="text-xs px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => onReject(a.id)}
                disabled={busyId === a.id}
                className="text-xs px-2 py-1 rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Quick suggestions (floating widget's empty state only) ───────────────────
const QUICK_SUGGESTIONS = [
  "Show my tasks",
  "Create a task for today",
  "What's overdue?",
  "Summarise my week",
];

// ─── Voice recording indicator ───────────────────────────────────────────────
const WAVEFORM_BAR_WIDTH = 2;
const WAVEFORM_BAR_GAP = 2;
const WAVEFORM_SAMPLE_INTERVAL_MS = 55; // cadence at which new bars are appended
const WAVEFORM_MIN_LEVEL = 0.08; // flat/idle bar height when no sound is detected

function VoiceListeningChip({ analyserRef, onCancel, onConfirm }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const rafIdRef = useRef(null);
  const freqDataRef = useRef(null);
  // Rolling history of sampled levels (0..1), oldest first, newest last —
  // this is what makes new bars appear on the right and old ones scroll
  // left/off, instead of a fixed set of bars animating in place.
  const historyRef = useRef([]);
  const lastSampleAtRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    let cssWidth = 0;
    let cssHeight = 0;

    const INSET_X = 4; // matches the canvas's left-1/right-1 Tailwind inset

    const resize = () => {
      const rect = container.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width - INSET_X * 2);
      cssHeight = rect.height;
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const sampleLevel = () => {
      const analyser = analyserRef.current;
      if (!analyser) return 0;
      if (!freqDataRef.current || freqDataRef.current.length !== analyser.frequencyBinCount) {
        freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
      const data = freqDataRef.current;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      return sum / data.length / 255; // 0..1 real mic level, not synthetic
    };

    const draw = (now) => {
      const step = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
      const capacity = Math.max(1, Math.ceil(cssWidth / step) + 1);

      if (now - lastSampleAtRef.current >= WAVEFORM_SAMPLE_INTERVAL_MS) {
        lastSampleAtRef.current = now;
        historyRef.current.push(sampleLevel());
        while (historyRef.current.length > capacity) historyRef.current.shift();
      }

      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.fillStyle = "#94a3b8"; // slate-400

      const history = historyRef.current;
      for (let i = 0; i < history.length; i++) {
        const level = history[history.length - 1 - i]; // i=0 is newest (rightmost)
        const x = cssWidth - (i + 1) * step;
        if (x + WAVEFORM_BAR_WIDTH < 0) break;

        const barHeight = Math.max(
          cssHeight * WAVEFORM_MIN_LEVEL,
          Math.min(cssHeight, cssHeight * level * 1.7)
        );
        const y = (cssHeight - barHeight) / 2;
        ctx.globalAlpha = level > 0.03 ? 1 : 0.4;
        const r = WAVEFORM_BAR_WIDTH / 2;
        ctx.beginPath();
        ctx.moveTo(x, y + r);
        ctx.arcTo(x, y, x + WAVEFORM_BAR_WIDTH, y, r);
        ctx.arcTo(x + WAVEFORM_BAR_WIDTH, y, x + WAVEFORM_BAR_WIDTH, y + barHeight, r);
        ctx.arcTo(x + WAVEFORM_BAR_WIDTH, y + barHeight, x, y + barHeight, r);
        ctx.arcTo(x, y + barHeight, x, y, r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      rafIdRef.current = requestAnimationFrame(draw);
    };
    rafIdRef.current = requestAnimationFrame(draw);

    return () => {
      resizeObserver.disconnect();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      historyRef.current = [];
      lastSampleAtRef.current = 0;
    };
  }, [analyserRef]);

  return (
    <div className="flex items-center gap-2 bg-slate-900 rounded-full pl-1.5 pr-1.5 py-1.5 mb-2 shadow-sm">
      <button
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-500 text-lg font-light leading-none cursor-default"
        type="button"
        disabled
        tabIndex={-1}
      >
        +
      </button>

      <div ref={containerRef} className="relative flex-1 h-6 overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-y-0 left-1 right-1" />
      </div>

      <button
        onClick={onCancel}
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:bg-slate-800 transition-colors"
        title="Cancel"
        type="button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <button
        onClick={onConfirm}
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white text-slate-900 hover:bg-slate-100 transition-colors"
        title="Done"
        type="button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </button>
    </div>
  );
}

// ─── Voice support detection ──────────────────────────────────────────────────
const voiceSupported =
  typeof window !== "undefined" &&
  !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// ─── Main chat panel — shared by the floating widget and the full AI
// Assistant page. `variant` only controls outer layout/sizing; all the
// session/message/action logic below is identical either way. ────────────────
export default function ChatPanel({ variant = "floating", onClose, autoFocus = true }) {
  const { user } = useAuth();
  const { pageContext } = usePageContext();
  const isTeamMember = user?.role === "team_member";
  const visibleSuggestions = QUICK_SUGGESTIONS.filter(
    (s) => !(isTeamMember && s === "Create a task for today")
  );
  const isAdmin = user?.role === "admin";
  const [showSidebar, setShowSidebar] = useState(false);
  const [showApprovals, setShowApprovals] = useState(false);
  const [approvals, setApprovals] = useState([]);
  const [approvalBusyId, setApprovalBusyId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingActions, setPendingActions] = useState({});
  const [resolvedChangeSets, setResolvedChangeSets] = useState({});
  const [resolvedUndoOps, setResolvedUndoOps] = useState(new Set());
  const [isListening, setIsListening] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const analyserRef = useRef(null);
  const micStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isLoading]);
  useEffect(() => { if (autoFocus) setTimeout(() => inputRef.current?.focus(), 100); }, [autoFocus]);
  useEffect(() => { if (showSidebar) chatApi.listSessions().then(setSessions).catch(() => {}); }, [showSidebar]);

  // Auto-grow the composer only as far as the content actually needs —
  // stays a single compact line by default and expands line-by-line up to
  // max-h-32, instead of reserving multi-line height up front.
  const COMPOSER_MAX_HEIGHT_PX = 128;
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [input]);

  const refreshApprovals = useCallback(() => {
    if (!isAdmin) return;
    chatApi.listApprovals().then(setApprovals).catch(() => {});
  }, [isAdmin]);

  useEffect(() => { if (isAdmin) refreshApprovals(); }, [isAdmin, refreshApprovals]);
  useEffect(() => { if (showApprovals) refreshApprovals(); }, [showApprovals, refreshApprovals]);

  // Separate from SpeechRecognition — this is only for the live waveform
  // visualisation, so its failure (denied mic permission, no Web Audio
  // support, etc.) must never block voice recognition itself; it just
  // leaves the bars flat.
  const teardownAudioAnalyser = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const setupAudioAnalyser = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioCtx();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyserRef.current = analyser;
    } catch {
      analyserRef.current = null;
    }
  }, []);

  // Stop any in-progress voice recognition when this panel unmounts (e.g.
  // the floating widget is closed, or the user navigates off the full page).
  useEffect(() => () => {
    recognitionRef.current?.stop();
    teardownAudioAnalyser();
  }, [teardownAudioAnalyser]);

  const loadSession = useCallback(async (sessionId) => {
    try {
      const session = await chatApi.getSession(sessionId);
      setCurrentSessionId(session.id);
      setMessages(session.messages.map((m) => ({ ...m, actions: [] })));
    } catch { toast.error("Could not load session."); }
  }, []);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`File too large. Maximum size is ${MAX_FILE_MB} MB.`);
      return;
    }
    setSelectedFile(file);
    // Reset the input so the same file can be re-selected later
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const appendExchange = useCallback((response, tempIdToRemove = null) => {
    setCurrentSessionId(response.session_id);
    setMessages((prev) => {
      const without = tempIdToRemove != null ? prev.filter((m) => m.id !== tempIdToRemove) : prev;
      return [
        ...without,
        { ...response.user_message, actions: [] },
        { ...response.assistant_message, actions: response.actions || [] },
      ];
    });
    if (response.actions?.length) {
      setPendingActions((prev) => ({ ...prev, [response.assistant_message.id]: response.actions }));
    }
  }, []);

  const handleApprovalDecision = useCallback(async (approvalId, decision) => {
    setApprovalBusyId(approvalId);
    try {
      const response = decision === "approve"
        ? await chatApi.approveRequest(approvalId)
        : await chatApi.rejectRequest(approvalId);
      if (response.session_id === currentSessionId) appendExchange(response);
      setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
      toast.success(decision === "approve" ? "Approved." : "Rejected.");
    } catch {
      toast.error("Could not process that approval.");
    } finally {
      setApprovalBusyId(null);
    }
  }, [currentSessionId, appendExchange]);

  const handleConfirmChangeSet = useCallback(async (changeSetId) => {
    setResolvedChangeSets((prev) => ({ ...prev, [changeSetId]: "confirmed" }));
    try {
      const response = await chatApi.confirmChangeSet(changeSetId);
      appendExchange(response);
    } catch (err) {
      toast.error(err.message || "Could not confirm that action.");
      setResolvedChangeSets((prev) => ({ ...prev, [changeSetId]: undefined }));
    }
  }, [appendExchange]);

  const handleCancelChangeSet = useCallback(async (changeSetId) => {
    setResolvedChangeSets((prev) => ({ ...prev, [changeSetId]: "cancelled" }));
    try {
      const response = await chatApi.cancelChangeSet(changeSetId);
      appendExchange(response);
    } catch (err) {
      toast.error(err.message || "Could not cancel that action.");
      setResolvedChangeSets((prev) => ({ ...prev, [changeSetId]: undefined }));
    }
  }, [appendExchange]);

  const handleUndo = useCallback(async (operationId) => {
    setResolvedUndoOps((prev) => new Set(prev).add(operationId));
    try {
      const response = await chatApi.undoOperation(operationId);
      appendExchange(response);
    } catch (err) {
      toast.error(err.message || "Could not undo that action.");
      setResolvedUndoOps((prev) => {
        const next = new Set(prev);
        next.delete(operationId);
        return next;
      });
    }
  }, [appendExchange]);

  const handleSend = useCallback(
    async (text) => {
      const trimmed = (text || input).trim();
      if ((!trimmed && !selectedFile) || isLoading) return;

      const fileToSend = selectedFile;
      setInput("");
      setSelectedFile(null);

      const tempId = Date.now();
      const displayContent = fileToSend
        ? `[📎 ${fileToSend.name}]${trimmed ? `\n\n${trimmed}` : ""}`
        : trimmed;

      const optimisticUser = {
        id: tempId,
        session_id: currentSessionId,
        role: "user",
        content: displayContent,
        created_at: new Date().toISOString(),
        actions: [],
      };
      setMessages((prev) => [...prev, optimisticUser]);
      setIsLoading(true);

      try {
        let response;
        if (fileToSend) {
          response = await chatApi.uploadFile(fileToSend, trimmed, currentSessionId);
        } else {
          response = await chatApi.sendMessage(trimmed, currentSessionId, pageContext);
        }

        appendExchange(response, tempId);
        chatApi.listSessions().then(setSessions).catch(() => {});
      } catch (err) {
        toast.error(err.message || "Failed to send.");
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } finally {
        setIsLoading(false);
      }
    },
    [input, selectedFile, currentSessionId, isLoading, appendExchange]
  );

  // Keep a stable ref so voice callbacks always call the latest handleSend
  const handleSendRef = useRef(handleSend);
  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  const stopListening = useCallback(() => {
    // stop() finishes gracefully — the recognizer still fires onresult with
    // whatever it captured, which is what "confirm" should do.
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    teardownAudioAnalyser();
    setIsListening(false);
  }, [teardownAudioAnalyser]);

  const cancelListening = useCallback(() => {
    // abort() cuts off immediately without producing a final result — this
    // is what makes "cancel" actually discard the recording instead of
    // sending whatever was captured so far.
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    teardownAudioAnalyser();
    setIsListening(false);
  }, [teardownAudioAnalyser]);

  const startListening = useCallback(() => {
    if (!voiceSupported || isListening || isLoading) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
      setupAudioAnalyser();
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      setIsListening(false);
      recognitionRef.current = null;
      teardownAudioAnalyser();
      if (transcript) {
        handleSendRef.current(transcript);
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        toast.error("Voice recognition failed. Please try again or check microphone permissions.");
      }
      setIsListening(false);
      recognitionRef.current = null;
      teardownAudioAnalyser();
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      teardownAudioAnalyser();
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isListening, isLoading, setupAudioAnalyser, teardownAudioAnalyser]);

  const toggleVoice = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const startNewChat = () => { setCurrentSessionId(null); setMessages([]); setSelectedFile(null); setShowSidebar(false); };

  const handleDeleteSession = async (sessionId) => {
    try {
      await chatApi.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (sessionId === currentSessionId) startNewChat();
    } catch { toast.error("Could not delete session."); }
  };

  const handleNavigate = (path) => {
    navigate(path);
    if (variant === "floating") onClose?.();
  };

  const canSend = (input.trim() || selectedFile) && !isLoading;

  const isFloating = variant === "floating";
  const isEmpty = messages.length === 0 && !isLoading;

  const composerBox = (
    <>
      {/* Voice listening chip */}
      {isListening && (
        <VoiceListeningChip analyserRef={analyserRef} onCancel={cancelListening} onConfirm={stopListening} />
      )}

      {/* Selected file chip */}
      {selectedFile && (
        <SelectedFileChip file={selectedFile} onRemove={() => setSelectedFile(null)} />
      )}

      {/* Text + controls — textarea on top, icon row pinned to the bottom.
          The box only grows as tall as the content needs (see the
          auto-resize effect above), so it stays a compact single line
          until the message actually wraps. */}
      <div className={`flex flex-col gap-1 bg-white rounded-2xl border transition-all px-3 py-1.5 ${isListening ? "border-red-300" : "border-slate-200 focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-100 focus-within:shadow-sm"}`}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isListening
              ? "Listening… speak your message"
              : selectedFile
              ? "Add a message or just send the file…"
              : "Message AI Assistant"
          }
          disabled={isListening}
          className="w-full bg-transparent text-sm text-slate-800 placeholder-slate-400 resize-none outline-none disabled:cursor-not-allowed leading-6 py-0.5"
          rows={1}
        />

        <div className="flex items-center justify-between">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors text-lg font-light leading-none"
            title="Attach file (PDF, DOCX, TXT, MD, CSV, JSON)"
            type="button"
            disabled={isListening}
          >
            +
          </button>

          <div className="flex items-center gap-1">
            {/* Mic button */}
            {voiceSupported && (
              <button
                onClick={toggleVoice}
                disabled={isLoading}
                className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                  isListening
                    ? "text-red-500 hover:bg-red-50 animate-pulse"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={isListening ? "Stop recording" : "Send a voice message"}
                type="button"
              >
                {isListening ? (
                  // Stop icon when recording
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
                  </svg>
                ) : (
                  // Mic icon when idle
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>
            )}

            {/* Send button */}
            <button
              onClick={() => handleSend()}
              disabled={!canSend || isListening}
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                canSend && !isListening
                  ? "bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-sm shadow-indigo-500/30 hover:shadow-md hover:shadow-indigo-500/40 hover:scale-105"
                  : "text-slate-300"
              } disabled:cursor-not-allowed disabled:hover:scale-100`}
              title="Send"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19V5m0 0l-6 6m6-6l6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-1.5 text-center">
        PDF · DOCX · TXT · MD · CSV · JSON — max {MAX_FILE_MB} MB
        {voiceSupported && " · 🎙 Voice"}
      </p>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleFileSelect}
        className="hidden"
      />
    </>
  );

  return (
    <div
      className={isFloating
        ? "fixed bottom-24 right-6 z-50 flex shadow-2xl rounded-2xl overflow-hidden border border-slate-200"
        : "flex w-full h-full"}
      style={isFloating ? {
        width: showSidebar || showApprovals ? 640 : 400,
        maxWidth: "calc(100vw - 24px)",
        height: 580,
        maxHeight: "calc(100vh - 120px)",
      } : undefined}
    >
      {showSidebar && (
        <SessionSidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={(id) => { loadSession(id); setShowSidebar(false); }}
          onNew={startNewChat}
          onDelete={handleDeleteSession}
        />
      )}
      {showApprovals && (
        <ApprovalsPanel
          approvals={approvals}
          busyId={approvalBusyId}
          onApprove={(id) => handleApprovalDecision(id, "approve")}
          onReject={(id) => handleApprovalDecision(id, "reject")}
        />
      )}

      <div className={`flex flex-col flex-1 min-w-0 min-h-0 ${isFloating ? "bg-white" : "bg-slate-100"}`}>
        {/* Header — the full page already shows its own title above this
            panel (see AIAssistantPage), so here it's just controls. History
            and New chat are grouped together as labeled buttons (rather than
            split to opposite corners) since they're the two things people
            actually reach for together when managing conversations. */}
        <div className={`flex items-center justify-between flex-shrink-0 ${isFloating ? "px-3 py-2.5 bg-white border-b border-slate-100" : "px-3 py-2.5"}`}>
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => setShowSidebar((v) => !v)}
              className={`flex items-center gap-1.5 text-xs font-medium rounded-lg transition-colors ${isFloating ? "p-2" : "px-2.5 py-1.5"} ${showSidebar ? "bg-slate-200 text-slate-900" : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70"}`}
              title="Chat history"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              {!isFloating && "History"}
            </button>
            <button
              onClick={startNewChat}
              className={`flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg transition-colors ${isFloating ? "p-2" : "px-2.5 py-1.5"}`}
              title="New chat"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {!isFloating && "New chat"}
            </button>
            {isFloating && (
              <div className="flex items-center gap-2 ml-0.5 min-w-0">
                <span className="w-6 h-6 flex-shrink-0 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 2l1.6 4.8L16.4 8 11.6 9.6 10 14.4 8.4 9.6 3.6 8l4.8-1.2L10 2z" />
                    <path d="M16 13l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
                  </svg>
                </span>
                <h3 className="text-sm font-semibold text-slate-800 truncate">AI Assistant</h3>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isAdmin && (
              <button
                onClick={() => setShowApprovals((v) => !v)}
                className={`relative flex items-center gap-1.5 text-xs font-medium rounded-lg transition-colors ${isFloating ? "p-2" : "px-2.5 py-1.5"} ${showApprovals ? "bg-slate-200 text-slate-900" : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70"}`}
                title="Pending approvals"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {!isFloating && "Approvals"}
                {approvals.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-[10px] leading-4 text-white font-semibold text-center">
                    {approvals.length}
                  </span>
                )}
              </button>
            )}
            {isFloating && (
              <button onClick={onClose} className="text-slate-500 hover:text-slate-800 transition-colors p-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {isEmpty && !isFloating ? (
          /* Full page, nothing sent yet — the composer itself sits centered
             in the middle of the panel (no welcome text/suggestions), then
             moves down to its normal bottom position as soon as the first
             message is sent. */
          <div className="flex-1 flex items-center justify-center px-4 min-h-0">
            <div className="mx-auto w-full max-w-2xl">
              {composerBox}
            </div>
          </div>
        ) : (
          <>
            {/* Messages — centered, max-width column on the full page (like
                Claude's conversation column); the floating widget stays
                full width since it's already narrow. */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className={isFloating ? "" : "mx-auto w-full max-w-2xl"}>
                {/* The floating widget keeps its original welcome message +
                    quick-suggestion pills in the empty state — only the full
                    page dropped those in favor of a centered composer. */}
                {isEmpty && isFloating && (
                  <div className="flex flex-col items-center justify-center text-center gap-4 h-full">
                    <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 shadow-lg shadow-indigo-500/25 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2l1.6 4.8L16.4 8 11.6 9.6 10 14.4 8.4 9.6 3.6 8l4.8-1.2L10 2z" />
                        <path d="M16 13l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
                      </svg>
                    </span>
                    <p className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent font-bold text-xl">
                      Welcome, how can I help?
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center mt-1">
                      {visibleSuggestions.map((s, i) => {
                        const dotColors = ["bg-indigo-400", "bg-emerald-400", "bg-amber-400", "bg-fuchsia-400"];
                        return (
                          <button
                            key={s}
                            onClick={() => handleSend(s)}
                            className="flex items-center gap-1.5 text-xs bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-full transition-all border border-slate-200 hover:border-slate-300 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${dotColors[i % dotColors.length]}`} />
                            {s}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 text-xs text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 hover:border-indigo-200 px-4 py-2 rounded-full transition-all shadow-sm hover:shadow-md"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      Upload a file to analyse
                    </button>
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    actions={msg.actions || pendingActions[msg.id] || []}
                    onNavigate={handleNavigate}
                    onConfirmChangeSet={handleConfirmChangeSet}
                    onCancelChangeSet={handleCancelChangeSet}
                    onUndo={handleUndo}
                    resolvedChangeSets={resolvedChangeSets}
                    resolvedUndoOps={resolvedUndoOps}
                  />
                ))}

                {isLoading && <TypingIndicator />}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Input area */}
            <div className={`flex-shrink-0 px-4 py-3 ${isFloating ? "" : "mx-auto w-full max-w-2xl"}`}>
              {composerBox}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
