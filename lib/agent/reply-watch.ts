// 29 Oct live (G14): "If Nithin doesn't reply to my last email by Friday, remind me" became a plain reminder
// "If Nithin doesn't reply my last email" tomorrow at 9 am. Now: a check on the named day; when it fires, Gogo looks
// in Gmail for a reply from that person since the request and only nudges if none came.

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
export const REPLY_CHECK_PREFIX = '📧 Follow-up check:'

function ymdIst(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d) }

/** "If Nithin doesn't reply (to my last email) by Friday, remind me" → who and when (10:00 IST that day). Pure. */
export function parseReplyWatch(text: string, now = new Date()): { name: string; atIso: string; message: string } | null {
  const t = String(text || '').trim()
  const m = t.match(/^(?:please\s+)?if\s+([A-Za-z][A-Za-z.'-]{1,30}(?:\s+[A-Z][A-Za-z.'-]{1,30})?)\s+(?:doesn'?t|does\s+not|hasn'?t|has\s+not|won'?t|didn'?t)\s+(?:reply|respond|get\s+back|write\s+back)(?:\s+(?:to|on)\s+(?:my\s+)?(?:last\s+|latest\s+)?(?:e-?mail|mail|message))?\s+(?:by|before|until|till)\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b[\s,]*(?:then\s+)?(?:please\s+)?remind\s+me\b/i)
  if (!m) return null
  const name = m[1].replace(/\b\w/g, c => c.toUpperCase())
  const day = m[2].toLowerCase()
  const today = ymdIst(now)
  const base = new Date(`${today}T00:00:00Z`)
  let add = day === 'today' ? 0 : day === 'tomorrow' ? 1 : ((DAYS.indexOf(day) - base.getUTCDay() + 7) % 7)
  let at = new Date(`${today}T10:00:00+05:30`).getTime() + add * 86_400_000
  if (at <= now.getTime() + 5 * 60_000) at += day === 'today' ? 0 : 7 * 86_400_000
  if (at <= now.getTime()) at = now.getTime() + 60 * 60_000
  return { name, atIso: new Date(at).toISOString(), message: `${REPLY_CHECK_PREFIX} has ${name} replied to your last email?` }
}

/** The name in a stored follow-up check reminder. Pure. */
export function replyCheckName(message: string): string | null {
  const m = String(message || '').match(/^📧 Follow-up check: has (.+?) replied to your last email\?/)
  return m ? m[1] : null
}
