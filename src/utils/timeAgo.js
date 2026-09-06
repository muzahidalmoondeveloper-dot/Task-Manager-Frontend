// Extracted from components/layout/Navbar.jsx (previously module-local,
// duplicated logic rather than a shared reference) so the Activity Log
// page can reuse the exact same relative-time convention instead of
// reimplementing it.
export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
