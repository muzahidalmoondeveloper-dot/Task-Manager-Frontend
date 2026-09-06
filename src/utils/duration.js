// Formats a duration (not a time-of-day) given in whole seconds, e.g. for
// task working time. Deliberately does NOT wrap at 24 hours — a duration
// like 27h 10m must read as "27h 10m", never "3h 10m" — so this never
// goes through `Date`/clock-style formatting, only plain arithmetic.
//
// Compact/summary use only (stopped timers, list rows with no active
// timer). Rounds to whole minutes, so it visually changes only once a
// minute — an active, second-by-second-changing timer must use
// `formatLiveDurationSeconds()` below instead, never this one (that
// mismatch was the entire live-timer display bug: the interval driving
// the number was firing correctly every second, this formatter just
// swallowed anything under 60s into "0m").
export function formatDurationSeconds(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  if (seconds < 60) return "0m";

  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// Live/running-timer formatter — HH:MM:SS, visibly changing every single
// second, for an *active* timer only. Hours deliberately do NOT wrap at
// 24 (27h 10m 5s of active tracking reads "27:10:05", never "03:10:05"),
// so this is plain integer arithmetic throughout — never `Date`/
// clock-of-day formatting, which would wrap at 24h and misrepresent a
// duration as a time-of-day. Stopped/summary displays should keep using
// `formatDurationSeconds()` above; this is only for "is currently ticking".
export function formatLiveDurationSeconds(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}
