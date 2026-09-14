// OTP resend cooldown follow-up: the single shared value every OTP step
// (login, register, forgot-password) uses for its "Resend OTP" countdown
// — kept here so there is exactly one number to change, matching the
// backend's own single shared constant (OTP_RESEND_COOLDOWN_SECONDS in
// app/services/auth_security_service.py). This is a UX countdown only —
// the backend independently enforces the real cooldown on every
// POST /auth/resend-otp call regardless of what this local timer shows,
// so a page refresh (which resets this to 0) can never bypass it.
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
