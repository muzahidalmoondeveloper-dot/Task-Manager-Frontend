// Shared dropdown chrome — a native <select> wrapped to look like the
// pill-style org switcher button (rounded border, subtle bg, custom
// up/down chevron) instead of the browser's default select styling.
// Drop-in replacement: forwards all native <select> props/children unchanged.
function DoubleChevronIcon() {
  return (
    <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 5.5a.75.75 0 01.53.22l3 3a.75.75 0 11-1.06 1.06L10 7.31 7.53 9.78a.75.75 0 01-1.06-1.06l3-3A.75.75 0 0110 5.5zM6.47 12.28a.75.75 0 011.06 0L10 14.69l2.47-2.41a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 010-1.06z" />
    </svg>
  );
}

export default function Select({ className = "", wrapperClassName = "", hideChevron = false, ...props }) {
  // Selects declared `w-full` need their wrapper to grow to match, since the
  // wrapper (not the native select) is what determines layout width here.
  const isFullWidth = /(^|\s)w-full(\s|$)/.test(className);
  return (
    <span className={`relative ${isFullWidth ? "block w-full" : "inline-block"} ${wrapperClassName}`}>
      <select
        {...props}
        className={`appearance-none !rounded-xl !border !border-slate-200 !bg-slate-50 !pr-8 hover:!bg-slate-100 focus:!border-slate-900 focus:!bg-white focus:!outline-none ${className}`}
      />
      {!hideChevron && <DoubleChevronIcon />}
    </span>
  );
}
