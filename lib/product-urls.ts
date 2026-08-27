// ── Single source of truth for "where WhatsApp opens" ─────────────────────────
// Before this module every wa.me link and the dashboard WA_NUMBER was hardcoded,
// so a number change meant hunting every call site (exactly the pain of the
// 2026-08-27 cutover). Every place that hands a user back to WhatsApp — chips,
// the command bar, upgrade/dashboard redirects, bot referral/join links — now
// imports from here, so the number lives in ONE place.
//
// This is the USER-FACING contact number (the wa.me deep-link target), NOT the
// Twilio outbound "from" address. The sender is configured entirely via the
// TWILIO_WHATSAPP_NUMBER env var and never appears in code — do not conflate the
// two. Client-safe: pure constants + a pure helper, no server-only imports.

// +1 760-548-3659, digits-only in the wa.me canonical form.
export const WA_NUMBER = '17605483659'

// Build a wa.me deep link, optionally with a prefilled (not sent) message.
// waLink()            -> https://wa.me/17605483659
// waLink('Hi Gogo')   -> https://wa.me/17605483659?text=Hi%20Gogo
export function waLink(text?: string): string {
  const base = `https://wa.me/${WA_NUMBER}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}
