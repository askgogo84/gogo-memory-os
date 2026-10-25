// "When is Jailer 2 releasing and add it to my calendar" is two asks in one sentence: a lookup
// and a calendar write that depends on its answer. Answer the lookup, then set up the calendar
// entry as a pending question (date/time from the user) so the normal approval-gated create runs.
// Nothing is written to the calendar from this turn.

export type LookupThenCalendar = { question: string; subject: string; title: string }

const JOIN = String.raw`(?:\s*,?\s*(?:and|&|then|,)\s+(?:please\s+)?|\s*[.?!]\s*(?:please\s+)?(?:also\s+)?)`
const WRITE = String.raw`(?:add|put|save|block|mark|pencil)\s+(?:it|that|this|the\s+(?:date|release|day))\s+(?:to|in|on|into)\s+(?:my\s+|the\s+)?(?:google\s+)?(?:calendar|calender|calandar|cal)\b`
const COMPOUND_RE = new RegExp(String.raw`^\s*(.+?)` + JOIN + WRITE + String.raw`[\s.!?]*$`, 'i')
const LOOKUP_RE = /^(?:when|what\s+(?:date|day|time)|which\s+(?:date|day))\b/i
const RELEASE_RE = /\b(?:releas(?:e|es|ing|ed)|com(?:e|es|ing)\s+out|launch(?:es|ing)?|premier(?:e|es|ing)|out\s+in\s+theat(?:re|er)s|hit(?:s|ting)?\s+theat(?:re|er)s|drop(?:s|ping)?)\b/i

export function parseLookupThenCalendar(text: string): LookupThenCalendar | null {
  const m = String(text || '').match(COMPOUND_RE)
  if (!m) return null
  const question = m[1].trim().replace(/[\s,]+$/, '')
  if (!LOOKUP_RE.test(question)) return null
  const subject = question
    .replace(LOOKUP_RE, '')
    .replace(/^\s*(?:is|are|does|do|will|would|did|was)\s+(?:the\s+)?/i, '')
    .replace(RELEASE_RE, ' ')
    .replace(/\b(?:date|happening|scheduled|starting|start|in\s+india|in\s+cinemas)\b/gi, ' ')
    .replace(/[?!.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!subject || subject.length > 80) return null
  const title = RELEASE_RE.test(question) ? `${subject} release` : subject
  return { question: /\?$/.test(question) ? question : `${question}?`, subject, title }
}

// Second half of the reply: says plainly that nothing was added and how to finish it. When the
// answer names a date, it is offered as the example so a one-word "yes, 10 am" is enough context.
export function calendarFollowupLine(title: string, suggestedDate?: string | null): string {
  if (!suggestedDate) return `📅 I couldn't find a confirmed upcoming date for *${title}*. When you have one, reply with the date and time (e.g. *14 November, 10 am*) and I'll set it up for your approval — nothing added yet.`
  return `📅 To add *${title}* on *${suggestedDate}*, reply with a time (e.g. *${suggestedDate}, 10 am*). I'll set it up for your approval — nothing added yet.`
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

// First explicit future calendar date in the answer ("14 November 2026", "November 14"), formatted
// "14 November". Dates already past (relative to `now`, IST) are ignored.
export function firstFutureDate(answer: string, now = new Date()): string | null {
  const text = String(answer || '')
  const re = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b(?:,?\s+(\d{4}))?|\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/gi
  const ist = new Date(now.getTime() + 5.5 * 3600_000)
  const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())
  for (const m of text.matchAll(re)) {
    const day = Number(m[1] || m[5])
    const monName = String(m[2] || m[4]).toLowerCase()
    const month = MONTHS.findIndex(name => name.startsWith(monName.slice(0, 3)))
    if (month < 0 || day < 1 || day > 31) continue
    const explicitYear = m[3] || m[6]
    let year = explicitYear ? Number(explicitYear) : ist.getUTCFullYear()
    let at = Date.UTC(year, month, day)
    // No year: a date a few days/weeks back is in the past ("came out on October 14"); only a date
    // long gone this year ("expected 10 January" said in October) means next year.
    if (!explicitYear && at < today && today - at > 120 * 86_400_000) { year += 1; at = Date.UTC(year, month, day) }
    // Today's date is usually the answer restating the current date ("since today is October 20"),
    // not the event's date; an event date must be strictly after today.
    if (at <= today) continue
    return `${day} ${MONTHS[month].charAt(0).toUpperCase()}${MONTHS[month].slice(1)}${explicitYear && year !== ist.getUTCFullYear() ? ` ${year}` : ''}`
  }
  return null
}

// The answer says the thing has already happened ("has already released", "came out last week") and
// names no future date: there is nothing to put on the calendar.
export function alreadyHappened(answer: string, now = new Date()): boolean {
  if (firstFutureDate(answer, now)) return false
  // 20 Oct live: "Pushpa 3 is expected… 2028… no exact date" plus a note that a *short film* released in
  // 2025 was read as "already out". An answer that says the thing is still expected is not past.
  if (/\b(?:expected|not\s+(?:yet\s+)?(?:been\s+)?announced|no\s+(?:exact|confirmed|official)\s+(?:release\s+)?date|upcoming|coming\s+soon|slated|yet\s+to\s+(?:be\s+)?release|in\s+(?:20[3-9]\d|202[7-9]))\b/i.test(String(answer || ''))) return false
  return /\b(?:already\s+(?:released|out|happened|launched|premiered|over)|came\s+out|was\s+released|released\s+(?:on|last)|is\s+(?:now\s+)?(?:out|in\s+theat(?:re|er)s|streaming))\b/i.test(String(answer || ''))
}

export function alreadyHappenedLine(title: string): string {
  return `📅 It's already out, so I haven't set up a calendar entry for *${title}*. Want showtimes near you instead?`
}
