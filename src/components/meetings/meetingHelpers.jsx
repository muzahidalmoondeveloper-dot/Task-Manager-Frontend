// The Avatar component only — see meetingConstants.js for the plain
// constants/functions it (and MeetingsTab/CreateMeetingModal) share.
import { AVATAR_COLORS, getInitials } from "./meetingConstants";

export function Avatar({ name, size = "h-7 w-7" }) {
  const idx = name ? name.charCodeAt(0) % AVATAR_COLORS.length : 0;
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-xs font-semibold text-white ${size} ${AVATAR_COLORS[idx]}`}>
      {getInitials(name)}
    </span>
  );
}
