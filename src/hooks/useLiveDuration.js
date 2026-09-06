import { useEffect, useRef, useState } from "react";

// Shared baseline-based live-duration ticking, used everywhere a Working
// Time number needs to visibly progress while one or more timers are
// active (TaskTimeTracker, TasksPage/ProjectDetail/TeamDetail task rows,
// the Project Working Time card) — one implementation instead of three
// independent timer systems (see the Task List Working Time follow-up
// spec, "Shared Live-Duration Logic").
//
// The interval below only causes a rerender every second; it is never the
// source of truth. Each tick recomputes the displayed total from a stable
// baseline (the last authoritative server value) plus elapsed *monotonic*
// time (`performance.now()`, immune to wall-clock adjustments and, unlike
// a naive `setSeconds(seconds + 1)` accumulator, immune to dropped/
// throttled callbacks — a backgrounded tab that misses several ticks
// simply recomputes a bigger jump on the next one, never permanently
// losing time). `activeCount` lets a task with N simultaneously active
// timers advance N seconds of Working Time per real second (#7A: one
// active timer per user, never one per task).
//
// baselineSeconds/activeCount are expected to come straight off an
// authoritative API response and change (by reference-different primitive
// value) exactly when a fresh one arrives — that's what resets the
// baseline; this hook never invents or persists a duration itself.
export function useLiveDuration(baselineSeconds, activeCount) {
  const [displaySeconds, setDisplaySeconds] = useState(baselineSeconds || 0);
  // No `performance.now()` here — reading the clock is an impure call and
  // must not happen during render (React's rules-of-hooks purity check).
  // The real timestamp is set by the effect below, which always runs
  // (synchronously, before the ticking effect can ever fire) on mount and
  // whenever baselineSeconds/activeCount change.
  const baselineRef = useRef({ seconds: baselineSeconds || 0, activeCount: activeCount || 0, perfNow: 0 });

  useEffect(() => {
    baselineRef.current = { seconds: baselineSeconds || 0, activeCount: activeCount || 0, perfNow: performance.now() };
    setDisplaySeconds(baselineSeconds || 0);
  }, [baselineSeconds, activeCount]);

  useEffect(() => {
    if (!activeCount) return undefined;
    const id = setInterval(() => {
      const { seconds, activeCount: count, perfNow } = baselineRef.current;
      const elapsed = Math.floor((performance.now() - perfNow) / 1000);
      setDisplaySeconds(seconds + elapsed * count);
    }, 1000);
    return () => clearInterval(id);
  }, [activeCount]);

  return displaySeconds;
}
