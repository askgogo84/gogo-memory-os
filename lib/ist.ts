// ── The one IST day-window helper ─────────────────────────────────────────────
// AskGogo's users live in India; "today" always means the Asia/Kolkata day, not
// the server's UTC day. Asia/Kolkata is a fixed UTC+5:30 with no DST, so the
// start of the local day is a pure arithmetic shift — no Intl, no tz library.
//
// This lives in a neutral module (not in a bot handler or the dashboard) because
// both the bot (lib/bot/handlers/friend-reminders.ts) and the dashboard
// (lib/dashboard/queries.ts) need the exact same window. Two copies would drift.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/**
 * The UTC instants bounding the current IST calendar day: `[startUtc, endUtc)`,
 * a 24h half-open window. `endUtc` is the start of the next IST day.
 */
export function istDayWindow(now: Date = new Date()): { startUtc: Date; endUtc: Date } {
  const startMs = Math.floor((now.getTime() + IST_OFFSET_MS) / 864e5) * 864e5 - IST_OFFSET_MS
  return { startUtc: new Date(startMs), endUtc: new Date(startMs + 864e5) }
}
