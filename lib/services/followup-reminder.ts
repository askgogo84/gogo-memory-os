/**
 * Conditional Follow-up Reminder Service
 * 
 * "Remind me about Rahul's proposal if I don't hear back in 3 days"
 * "Follow up with Priya about the invoice if no reply by Friday"
 * "Chase Mathew about the deck if nothing by tomorrow"
 * 
 * How it works:
 * - Saved as a special reminder with pattern: "followup:3d:Rahul's proposal"
 * - Cron checks if it's due, sends reminder
 * - User can dismiss ("done") or snooze ("snooze 2 days")
 */

export interface FollowupReminder {
  kind: 'followup'
  message: string       // "Follow up with Rahul about the proposal"
  contact?: string      // "Rahul" (extracted name)
  about?: string        // "the proposal" (extracted topic)
  remindAtIso: string   // when to fire
  daysFromNow: number   // 1, 2, 3, 7 etc
  pattern: string       // "followup:3d:follow up with Rahul about the proposal"
}

// ── Intent detection ──────────────────────────────────────────────────────────

export function isFollowupReminderText(text: string): boolean {
  const lower = (text || '').toLowerCase()
  return (
    /if (he|she|they|i|we) (don'?t|doesn'?t|haven'?t|hasn'?t) (hear|reply|respond|get back|come back)/i.test(text) ||
    /if no (reply|response|answer|word|update|news)/i.test(text) ||
    /if (nothing|no response|no reply|haven'?t heard)/i.test(text) ||
    /follow.?up (with|on|about).+in \d+/i.test(text) ||
    /chase .+ (in|after|within) \d+/i.test(text) ||
    /remind me.+if.+(no reply|don'?t hear|no response)/i.test(text) ||
    /nudge me.+if/i.test(text) ||
    /(ping|remind|follow.?up|check).+(tomorrow|in \d+|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)).+if/i.test(lower)
  )
}

// ── Parser ────────────────────────────────────────────────────────────────────

export function parseFollowupReminder(text: string): FollowupReminder | null {
  // Extract days/time
  const daysMatch = text.match(/in (\d+)\s*(day|days|d)\b/i) ||
                    text.match(/(\d+)\s*(day|days|d)\s*(from now|later)/i)
  
  const weekdayMatch = text.match(/by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i) ||
                       text.match(/(?:until|till)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
  
  const tomorrowMatch = /\btomorrow\b/i.test(text)
  const weekMatch = text.match(/in (\d+)\s*(week|weeks)/i)

  let daysFromNow = 3 // default 3 days
  if (daysMatch) daysFromNow = parseInt(daysMatch[1])
  else if (weekMatch) daysFromNow = parseInt(weekMatch[1]) * 7
  else if (tomorrowMatch) daysFromNow = 1
  else if (weekdayMatch) {
    const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    const targetDay = weekdays.indexOf(weekdayMatch[1].toLowerCase())
    const today = new Date().getDay()
    daysFromNow = ((targetDay - today + 7) % 7) || 7
  }

  // Extract contact name
  const contactMatch = 
    text.match(/(?:follow.?up|chase|remind|ping|nudge|check)\s+(?:with|on)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i) ||
    text.match(/remind\s+(?:me\s+)?(?:to\s+)?(?:follow.?up\s+)?(?:with\s+)?([A-Z][a-z]+)/i)
  
  const contact = contactMatch?.[1]?.trim()

  // Extract topic/about
  const aboutMatch = 
    text.match(/(?:about|regarding|re:|on)\s+(.{3,50}?)(?:\s+if|\s+in \d+|\s+by|\s+tomorrow|$)/i) ||
    text.match(/(?:the\s+)(.{3,40}?)(?:\s+if|\s+in \d+|\s+by|\s+tomorrow|$)/i)
  
  const about = aboutMatch?.[1]?.trim()

  // Build clean message
  let message = ''
  // Clean up 'about' to avoid duplication if it starts with 'about'
  const cleanAbout = about?.replace(/^about\s+/i, '').replace(/^about\s+/i, '').trim()

  if (contact && cleanAbout) {
    message = `Follow up with ${contact} about ${cleanAbout}`
  } else if (contact) {
    message = `Follow up with ${contact}`
  } else if (cleanAbout) {
    message = `Follow up about ${cleanAbout}`
  } else {
    // Fallback: clean up the original text
    message = text
      .replace(/remind me (to )?/i, '')
      .replace(/if (he|she|they|i|we) (don'?t|doesn'?t|haven'?t|hasn'?t) (reply|respond|hear|get back).*/i, '')
      .replace(/if no (reply|response|answer).*/i, '')
      .replace(/in \d+ days?/i, '')
      .replace(/by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, '')
      .replace(/tomorrow/i, '')
      .trim()
  }

  if (!message || message.length < 3) return null

  // Calculate remind_at (IST)
  const now = new Date()
  const remindAt = new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1000)
  // Set to 9 AM IST (3:30 AM UTC)
  remindAt.setUTCHours(3, 30, 0, 0)
  if (remindAt <= now) remindAt.setDate(remindAt.getDate() + 1)

  return {
    kind: 'followup',
    message,
    contact: contact || undefined,
    about: about || undefined,
    remindAtIso: remindAt.toISOString(),
    daysFromNow,
    pattern: `followup:${daysFromNow}d:${message}`,
  }
}

// ── Confirmation message ──────────────────────────────────────────────────────

export function buildFollowupConfirmation(reminder: FollowupReminder): string {
  const daysText = reminder.daysFromNow === 1 ? 'tomorrow' 
    : reminder.daysFromNow === 7 ? 'in a week'
    : `in ${reminder.daysFromNow} days`

  const dateStr = new Date(reminder.remindAtIso).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata'
  })

  return (
    `🔔 *Follow-up reminder set!*\n\n` +
    `📋 *${reminder.message}*\n\n` +
    `⏰ I'll remind you *${daysText}* (${dateStr} at 9 AM) if you haven't already marked it done.\n\n` +
    `_Reply *done* or *resolved* when it's sorted — I'll cancel the reminder._`
  )
}

// ── WhatsApp reminder message ─────────────────────────────────────────────────

export function buildFollowupReminderMessage(message: string): string {
  return (
    `🔔 *Follow-up reminder*\n\n` +
    `📋 ${message}\n\n` +
    `Did you hear back?\n` +
    `• Reply *done* — mark as resolved\n` +
    `• Reply *snooze 2 days* — remind again later\n` +
    `• Reply *snooze friday* — remind on Friday`
  )
}
