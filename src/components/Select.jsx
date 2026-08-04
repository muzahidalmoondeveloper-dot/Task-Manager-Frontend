import { Children, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Shared dropdown — a fully custom trigger + option list (not a native
// <select>) so the open menu can actually be styled consistently across
// browsers. Native <select> popups are OS-rendered and can't be restyled
// (no rounded corners, no custom hover/selected colors, no shadow), which
// is what this replaces everywhere the app uses <Select>.
//
// Drop-in API-compatible with a native <select>: value / onChange (fires
// {target: {name, value}}, same shape code already expects) / children as
// plain <option value="...">Label</option> / name / required / disabled /
// className / wrapperClassName / hideChevron. A real (visually hidden but
// not display:none) native <select> is kept in the DOM in sync with the
// current value purely so browser form semantics — `required` constraint
// validation, form.reset(), autofill tooling — keep working; the user
// never interacts with it directly, only with the custom button + panel.
const MENU_MIN_WIDTH = 160;
const VIEWPORT_MARGIN = 8;

function DoubleChevronIcon({ className = "" }) {
  return (
    <svg className={`pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 ${className}`} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 5.5a.75.75 0 01.53.22l3 3a.75.75 0 11-1.06 1.06L10 7.31 7.53 9.78a.75.75 0 01-1.06-1.06l3-3A.75.75 0 0110 5.5zM6.47 12.28a.75.75 0 011.06 0L10 14.69l2.47-2.41a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 010-1.06z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
    </svg>
  );
}

export default function Select({
  className = "",
  wrapperClassName = "",
  hideChevron = false,
  value,
  onChange,
  children,
  disabled = false,
  required = false,
  name,
  id,
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const options = useMemo(() => {
    const list = [];
    Children.forEach(children, (child) => {
      if (!child || child.type !== "option") return;
      list.push({
        value: child.props.value ?? "",
        label: child.props.children,
        disabled: !!child.props.disabled,
      });
    });
    return list;
  }, [children]);

  const selected = options.find((o) => String(o.value) === String(value ?? ""));

  const positionMenu = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, MENU_MIN_WIDTH);
    const left = Math.min(Math.max(r.left, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN);
    const spaceBelow = window.innerHeight - r.bottom;
    const openUpward = spaceBelow < 220 && r.top > spaceBelow;
    setMenuPos(
      openUpward
        ? { left, width, bottom: window.innerHeight - r.top + 4 }
        : { left, width, top: r.bottom + 4 }
    );
  };

  useEffect(() => {
    if (!open) return;
    positionMenu();

    function onOutside(e) {
      // The menu renders through a portal into document.body, so it is NOT
      // a DOM descendant of rootRef even though it's a React child — check
      // both, or every mousedown on an option gets misread as "outside"
      // and closes the menu before the option's own onClick ever fires
      // (mousedown precedes click), silently swallowing every selection.
      if (rootRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    // capture:true so scrolling inside any ancestor scroll container (e.g. a
    // scrollable modal body) is caught too, not just window-level scroll.
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", positionMenu, true);
    window.addEventListener("resize", positionMenu);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", positionMenu, true);
      window.removeEventListener("resize", positionMenu);
    };
  }, [open]);

  function selectOption(opt) {
    if (opt.disabled) return;
    setOpen(false);
    onChange?.({ target: { name, value: opt.value } });
  }

  const isFullWidth = /(^|\s)w-full(\s|$)/.test(className);
  // Callers that need the wrapper positioned absolutely (e.g. an invisible
  // full-size trigger overlaid on a decorative fake-dropdown div) pass
  // their own position utility via wrapperClassName. Tailwind's "position"
  // utilities all set the same CSS property, and "relative" is declared
  // after "absolute" in Tailwind's own stylesheet — so having both classes
  // present at once silently makes "relative" win and the overlay never
  // actually stretches to cover its parent, breaking clicks on it. Only
  // fall back to "relative" when the caller didn't specify their own.
  const wrapperHasOwnPosition = /(^|\s)(absolute|fixed|sticky|static)(\s|$)/.test(wrapperClassName);

  return (
    <span
      ref={rootRef}
      className={`${wrapperHasOwnPosition ? "" : "relative"} ${isFullWidth ? "block w-full" : "inline-block"} ${wrapperClassName}`}
    >
      <button
        ref={buttonRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`flex items-center text-left appearance-none !rounded-xl !border !border-slate-200 !bg-white !pr-8 hover:!bg-slate-50 focus:!border-slate-400 focus:!outline-none focus-visible:!ring-2 focus-visible:!ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
        {...rest}
      >
        <span className="truncate">{selected ? selected.label : ""}</span>
      </button>

      {!hideChevron && <DoubleChevronIcon />}

      {/* Real native select, kept in sync but visually hidden and inert —
          exists only so `required` form validation and other native form
          semantics keep working; users never see or click this directly. */}
      <select
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        required={required}
        value={value ?? ""}
        onChange={() => {}}
        className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
      >
        <option value="" />
        {options.map((o) => (
          <option key={o.value} value={o.value}>{typeof o.label === "string" ? o.label : ""}</option>
        ))}
      </select>

      {open && !disabled && menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[300] max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
            style={{ left: menuPos.left, width: menuPos.width, top: menuPos.top, bottom: menuPos.bottom }}
            role="listbox"
          >
            {options.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">No options</p>
            ) : (
              options.map((o) => {
                const isSelected = String(o.value) === String(value ?? "");
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={o.disabled}
                    onClick={() => selectOption(o)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      o.disabled
                        ? "cursor-not-allowed text-slate-300"
                        : isSelected
                        ? "bg-slate-900 font-medium text-white"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {isSelected && <CheckIcon />}
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )}
    </span>
  );
}
