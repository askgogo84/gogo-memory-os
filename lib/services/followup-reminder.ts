/**
 * Follow-up reminders — persistent "re-nudge until done".
 *
 * Triggers on either:
 *   - conditional: "remind me about X if I don't hear back in 3 days"
 *   - persistent:  "keep reminding me to call the bank", "nag me about the invoice
 *                   every 2 hours until done", "don't let me forget to pay rent"
 *
 * Saved as a reminder with pattern "followup:<interval>:<message>" (e.g.
 * followup:1d:..., followup:2h:...). The cron re-fires at that cadence until the
 * user replies "done", or a safety cap stops it (~7 days / 20 nudges).
 */

export interface FollowupReminder {
  kind: 'followup'
  message: string        // clean task label, e.g. "Call the bank"
  contact?: string
  about?: string
  remindAtIso: string    // first fire
  intervalToken: string  // "1d" | "2h" | "12h" | "3d"
  intervalLabel: string  // "daily" | "every 2 hours" | "twice a day"
  pattern: string        // "followup:<intervalToken>:<message>"
}

// ── Intent detection ─────────────────────────────────────────────────────────
export function isFollowupReminderText(text: string): boolean {
  const t = text || ''
  return (
    // conditional "if no reply"
    /if (he|she|they|i|we) (don'?t|doesn'?t|haven'?t|hasn'?t) (hear|reply|respond|get back|come back)/i.test(t) ||
    /if no (reply|response|answer|word|update|news)/i.test(t) ||
    /if (nothing|no response|no reply|haven'?t heard)/i.test(t) ||
    /follow.?up (with|on|about).+in \d+/i.test(t) ||
    /chase .+ (in|after|within) \d+/i.test(t) ||
    /remind me.+if.+(no reply|don'?t hear|no response)/i.test(t) ||
    /nudge me.+if/i.test(t) ||
    // persistent "until done"
    /keep reminding me/i.test(t) ||
    /\bnag me\b/i.test(t) ||
    /don'?t let me forget/i.test(t) ||
    /\buntil (i|it'?s?)\s+(do|done|finish|complete|sort)/i.test(t) ||
    /every\s+\d+\s*(?:hours?|days?)\b.*\buntil\b/i.test(t)
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function istClockToday(hour: number, minute: number): Date {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000)
  const y = ist.getUTCFullYear(), mo = ist.getUTCMonth(), d = ist.getUTCDate()
  return new Date(Date.UTC(y, mo, d, hour - 5, minute - 30, 0))
}

function nextIst9am(): Date {
  const now = new Date()
  const r = new Date(now.getTime() + 24 * 3600 * 1000)
  r.setUTCHours(3, 30, 0, 0) // 09:00 IST
  if (r <= now) r.setUTCDate(r.getUTCDate() + 1)
  return r
}

// Only an explicit clock time (am/pm or "at N"), never "2 hours"/"3 days".
function extractClock(t: string): { hour: number; minute: number } | null {
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (m) { let h = (parseInt(m[1], 10) % 12); if (/pm/i.test(m[3])) h += 12; return { hour: h, minute: m[2] ? parseInt(m[2], 10) : 0 } }
  m = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:hour|day|min))/i)
  if (m) {
    let h = parseInt(m[1], 10)
    if (h >= 1 && h <= 6) h += 12 // smart default: 1-6 = PM
    if (h === 24) h = 12
    return { hour: h, minute: m[2] ? parseInt(m[2], 10) : 0 }
  }
  return null
}

function buildMessage(t: string, contact?: string, about?: string): string {
  const cleanAbout = about?.replace(/^about\s+/i, '').trim()
  if (contact && cleanAbout) return `Follow up with ${contact} about ${cleanAbout}`
  if (contact) return `Follow up with ${contact}`
  if (cleanAbout) return `Follow up about ${cleanAbout}`
  return t
    .replace(/keep reminding me\s*(to\s*)?/i, '')
    .replace(/\bnag me\s*(to|about)?\s*/i, '')
    .replace(/don'?t let me forget\s*(to|about)?\s*/i, '')
    .replace(/remind me\s*(to\s*)?/i, '')
    .replace(/if (he|she|they|i|we) (don'?t|doesn'?t|haven'?t|hasn'?t) (reply|respond|hear|get back).*/i, '')
    .replace(/if no (reply|response|answer).*/i, '')
    .replace(/\buntil (i|it'?s?)\b.*/i, '')
    .replace(/every\s+\d+\s*(?:hours?|days?).*/i, '')
    .replace(/\b(hourly|every hour|twice a day|two times a day|2 times a day|daily|every day)\b/gi, '')
    .replace(/in \d+ days?/i, '')
    .replace(/by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, '')
    .replace(/\btomorrow\b/i, '')
    .replace(/\b(\d{1,2})(?::\d{2})?\s*(am|pm)\b/i, '')
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\b/i, '')
    .replace(/\s+/g, ' ').trim()
}

function stripToTask(t: string): string {
  return t
    .replace(/["'\u201c\u201d\u2018\u2019]/g, '')
    .replace(/^\s*(please\s+)?/i, '')
    .replace(/keep reminding me\s*/i, '')
    .replace(/\bnag me\s*/i, '')
    .replace(/don'?t let me forget\s*/i, '')
    .replace(/remind me\s*/i, '')
    .replace(/every\s+\d+\s*(?:hours?|days?)/i, '')
    .replace(/\b(hourly|every hour|twice a day|two times a day|2 times a day|daily|every day)\b/gi, '')
    .replace(/\buntil\b.*$/i, '')
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/i, '')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i, '')
    .replace(/^\s*(to|about|that)\s+/i, '')
    .replace(/\s+/g, ' ').trim()
}

// ── Parser ───────────────────────────────────────────────────────────────────
export function parseFollowupReminder(text: string): FollowupReminder | null {
  const t = text || ''

  // Cadence (interval)
  let intervalToken = '1d', intervalLabel = 'daily'
  let m: RegExpMatchArray | null
  if ((m = t.match(/every\s+(\d+)\s*hours?/i))) { intervalToken = `${m[1]}h`; intervalLabel = `every ${m[1]} hours` }
  else if ((m = t.match(/every\s+(\d+)\s*days?/i))) { intervalToken = `${m[1]}d`; intervalLabel = m[1] === '1' ? 'daily' : `every ${m[1]} days` }
  else if (/\b(hourly|every hour)\b/i.test(t)) { intervalToken = '1h'; intervalLabel = 'hourly' }
  else if (/\b(twice a day|two times a day|2 times a day)\b/i.test(t)) { intervalToken = '12h'; intervalLabel = 'twice a day' }
  else if (/\b(daily|every day)\b/i.test(t)) { intervalToken = '1d'; intervalLabel = 'daily' }

  const condDaysMatch = t.match(/in (\d+)\s*(day|days|d)\b/i)

  // Persistent "keep reminding me to X" → bare task. Conditional "follow up with
  // PERSON about TOPIC" / "if no reply" → contact+about extraction.
  const persistent = /keep reminding me|nag me|don'?t let me forget/i.test(t) || /remind me\b.*\buntil\b/i.test(t)
  let contact: string | undefined
  let about: string | undefined
  if (!persistent) {
    const contactMatch =
      t.match(/(?:follow.?up|chase|ping|nudge|check)\s+(?:with|on)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
    contact = contactMatch?.[1]?.trim()
    const aboutMatch =
      t.match(/(?:about|regarding|re:)\s+(.{3,50}?)(?:\s+if|\s+in \d+|\s+by|\s+tomorrow|\s+every|\s+until|$)/i)
    about = aboutMatch?.[1]?.trim()
  }

  const message = persistent ? stripToTask(t) : buildMessage(t, contact, about)
  if (!message || message.length < 3) return null

  // First fire
  const now = new Date()
  let remindAt: Date
  const clock = extractClock(t)
  if (clock) {
    remindAt = istClockToday(clock.hour, clock.minute)
    if (remindAt <= now) remindAt = new Date(remindAt.getTime() + 24 * 3600 * 1000)
  } else if (intervalToken.endsWith('h')) {
    remindAt = new Date(now.getTime() + parseInt(intervalToken, 10) * 3600 * 1000)
  } else if (condDaysMatch) {
    remindAt = new Date(now.getTime() + parseInt(condDaysMatch[1], 10) * 24 * 3600 * 1000)
    remindAt.setUTCHours(3, 30, 0, 0)
    if (remindAt <= now) remindAt.setUTCDate(remindAt.getUTCDate() + 1)
  } else {
    remindAt = nextIst9am()
  }

  return {
    kind: 'followup', message, contact: contact || undefined, about: about || undefined,
    remindAtIso: remindAt.toISOString(), intervalToken, intervalLabel,
    pattern: `followup:${intervalToken}:${message}`,
  }
}

// ── Confirmation ─────────────────────────────────────────────────────────────
export function buildFollowupConfirmation(reminder: FollowupReminder): string {
  const dateStr = new Date(reminder.remindAtIso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  })
  return (
    `\ud83d\udd14 *Follow-up reminder set!*\n\n` +
    `\ud83d\udccb *${reminder.message}*\n\n` +
    `\u23f0 First nudge: ${dateStr}, then *${reminder.intervalLabel}* until you mark it done.\n\n` +
    `_Reply *done* when it's sorted and I'll stop. I'll also stop on my own after a week so I never spam you._`
  )
}

export function buildFollowupReminderMessage(message: string): string {
  return (
    `\ud83d\udd14 *Follow-up reminder*\n\n` +
    `\ud83d\udccb ${message}\n\n` +
    `\u2022 Reply *done* \u2014 mark as resolved (stops the nudges)\n` +
    `\u2022 Reply *snooze 2 days* \u2014 remind again later`
  )
}
