// Quiet WhatsApp (4 Nov, owner: "stop sending any whatsapp msgs unless it is necessary, including morning msgs").
// Gogo sends on its own only what the person asked for or must know: their reminders and follow-ups, a watch that
// triggered, flight tracking they started, results and approvals of tasks they started, sign-in codes, Ops Alerts.
// Everything Gogo used to volunteer — the morning briefing, 4-hourly check-ins, meeting nudges, goal-review pings —
// is off. The one exception is a single generic nudge after 3 quiet days (see lib/agent/reengage.ts).
// GOGO_PROACTIVE=all restores the old behaviour without a code change (kill-switch pattern, docs/launch/kill-switches.md).

export type VolunteeredKind = 'morning_briefing' | 'check_in' | 'meeting_nudge' | 'goal_review'

export function volunteeredSendsOn(env: Record<string, string | undefined> = (globalThis as any).process?.env || {}) {
  return String(env.GOGO_PROACTIVE || '').trim().toLowerCase() === 'all'
}

/** True when Gogo may send this volunteered message. Logs the skip so the quiet is visible in the logs. */
export function mayVolunteer(kind: VolunteeredKind, env?: Record<string, string | undefined>) {
  const on = volunteeredSendsOn(env)
  if (!on) console.log('PROACTIVE_QUIET:', JSON.stringify({ kind }))
  return on
}
