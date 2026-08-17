// The Avatar, AgendaSectionIcon, and FloatingReaction components — see
// meetingConstants.js for the plain constants/functions they (and
// MeetingsTab/CreateMeetingModal) share.
import { useEffect, useRef } from "react";
import { AVATAR_COLORS, getInitials } from "./meetingConstants";

export function Avatar({ name, size = "h-7 w-7" }) {
  const idx = name ? name.charCodeAt(0) % AVATAR_COLORS.length : 0;
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-xs font-semibold text-white ${size} ${AVATAR_COLORS[idx]}`}>
      {getInitials(name)}
    </span>
  );
}

// One icon per known Level 10 / EOS-preset agenda section `key` (see
// MEETING_TYPE_PRESETS in meetingConstants.js) — a section added freeform
// via "+ Add Section" has no key and falls back to a plain document icon.
const AGENDA_ICON_PATHS = {
  segue: "M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM1 20c0-3.314 2.686-6 6-6s6 2.686 6 6M11 20c0-2.21.895-4.21 2.343-5.657A5.978 5.978 0 0117 13c3.314 0 6 2.686 6 6",
  scorecard: "M3 3v18h18M8 17V10M13 17V6M18 17v-4",
  rock_review: "M12 3l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.27l-5.2 2.74.99-5.79-4.21-4.1 5.82-.85L12 3z",
  news: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13.5V3.75M18 13.5l3-1.5V6l-3-1.5m-11 6.15h6.5m-6.5 0a2.25 2.25 0 01-2.25-2.25v-.9a2.25 2.25 0 012.25-2.25h6.5v5.4h-6.5z",
  todo_list: "M9 12l2 2 4-4M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  ids: "M12 3l9 9-9 9-9-9 9-9zM12 9v4m0 3h.01",
  swot: "M3 3h18v18H3V3zM3 12h18M12 3v18",
  feedback: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.556-4.03 8.25-9 8.25a9.76 9.76 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z",
  conclude: "M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H6.633",
  default: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
};

export function AgendaSectionIcon({ sectionKey, className = "h-4 w-4" }) {
  const d = AGENDA_ICON_PATHS[sectionKey] || AGENDA_ICON_PATHS.default;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

// A single floating live-meeting reaction (👍 👏 ❤️ 😊) — rises from
// bottom:40px up through the meeting content and fades out near the top,
// à la Zoom/Meet reactions. Driven directly by the Web Animations API
// (element.animate()) rather than a Tailwind @keyframes class + CSS custom
// properties: that combination compiled correctly but never visibly
// animated in the browser (root-caused to how the per-instance --drift-x/
// --rise custom properties interacted with the class-applied `animation`
// shorthand — rather than keep chasing that, driving the animation
// directly and imperatively from JS sidesteps the whole class of problem
// and is trivially inspectable in devtools' Animations panel if it ever
// needs debugging again). Removes itself via `onDone` the instant the
// animation truly finishes — no separate setTimeout to keep in sync.
export function FloatingReaction({ emoji, left, driftX, duration, peakScale, riseVh, onDone }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") {
      onDone();
      return;
    }
    const rise = -riseVh; // e.g. -60 → "-60vh" worth of upward travel
    const animation = el.animate(
      [
        { opacity: 0, transform: "translateY(0) translateX(0) scale(0.7)" },
        { opacity: 1, transform: `translateY(${(rise * 0.08).toFixed(2)}vh) translateX(${(driftX * 0.1).toFixed(1)}px) scale(${peakScale})`, offset: 0.08 },
        { opacity: 1, transform: `translateY(${(rise * 0.35).toFixed(2)}vh) translateX(${(driftX * 0.4).toFixed(1)}px) scale(1)`, offset: 0.3 },
        { opacity: 1, transform: `translateY(${(rise * 0.6).toFixed(2)}vh) translateX(${(driftX * 0.65).toFixed(1)}px) scale(1)`, offset: 0.55 },
        { opacity: 0.4, transform: `translateY(${(rise * 0.9).toFixed(2)}vh) translateX(${(driftX * 0.9).toFixed(1)}px) scale(0.95)`, offset: 0.85 },
        { opacity: 0, transform: `translateY(${rise}vh) translateX(${driftX}px) scale(0.85)` },
      ],
      { duration: duration * 1000, easing: "ease-out", fill: "forwards" }
    );
    // Only a genuine natural finish removes this reaction. Deliberately no
    // `oncancel` handler: the cleanup below calls animation.cancel(), and
    // that includes React StrictMode's dev-only mount→cleanup→mount double
    // -invoke — wiring oncancel to onDone made that cleanup call remove
    // the reaction from state within milliseconds of it being created, so
    // it never got a chance to actually play (this was the real bug —
    // "not appearing" was this component being destroyed by its own
    // cancel handler almost immediately after mounting, in dev/StrictMode).
    animation.onfinish = onDone;
    return () => animation.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // one animation per mounted instance — this component is never reused for a different reaction

  return (
    <span
      ref={ref}
      className="absolute leading-none"
      style={{ left: `${left}%`, bottom: "40px", fontSize: "40px", opacity: 0 }}
    >
      {emoji}
    </span>
  );
}

// A brief emoji overlay pinned to a specific participant's avatar — the
// "who reacted" counterpart to the big floating FloatingReaction above.
// Sits on a light semi-transparent circle so the avatar underneath stays
// visible rather than being fully covered, pops in with a small bounce,
// holds for ~1.2s, then fades out and removes itself — same WAAPI-driven
// approach as FloatingReaction (see its comment for why: directly calling
// element.animate() sidesteps the CSS-class/custom-property animation
// bugs hit earlier in this file, and it's trivially re-triggerable by
// remounting with a fresh `key`, which is how the caller shows a second
// reaction from the same user before the first one has finished).
export function AvatarReactionBadge({ emoji, onDone }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") {
      onDone();
      return;
    }
    const animation = el.animate(
      [
        { opacity: 0, transform: "scale(0.4)", offset: 0 },
        { opacity: 1, transform: "scale(1.15)", offset: 0.18 },
        { opacity: 1, transform: "scale(1)", offset: 0.3 },
        { opacity: 1, transform: "scale(1)", offset: 0.78 },
        { opacity: 0, transform: "scale(0.9)", offset: 1 },
      ],
      { duration: 1600, easing: "ease-out", fill: "forwards" }
    );
    // Same reasoning as FloatingReaction: only a genuine finish removes it —
    // no oncancel handler, so React StrictMode's dev-only double-invoke
    // cleanup can't delete it before it's had a chance to play.
    animation.onfinish = onDone;
    return () => animation.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // one animation per mounted instance — a new reaction remounts this via a fresh key instead of reusing it

  return (
    <span
      ref={ref}
      className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-[13px] leading-none shadow ring-1 ring-black/5"
      style={{ opacity: 0 }}
    >
      {emoji}
    </span>
  );
}
