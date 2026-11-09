// 29 Oct live: "Keep tracking who's winning in Israel and tell me in the morning" sent a bare 7 am reminder
// "Check Israel election results", and the owner's own flight sent "departs in 3 hours" with no live status.
// A reminder that asks Gogo to check something is a job, not a nudge: at delivery Gogo does the check and
// sends the answer. If the check fails, the plain reminder still goes out (never silence, never invention).

const LOOKUP_VERB = /^(?:to\s+)?(?:check|see|look\s+up|find\s+out|get|tell\s+me|update\s+me\s+on|what(?:'s| is| happened)|how\s+did)\b/i
const LOOKUP_SUBJECT = /\b(?:results?|news|score|scores|status|updates?|price|prices|rate|rates|weather|forecast|winner|winning|won|election|elections|match|verdict|outcome|happened|happens)\b/i

/** "Check Israel election results", "see the match score", "find out what happened with the verdict". */
export function isLookupReminder(message: string): boolean {
  const t = String(message || '').replace(/^[\p{Extended_Pictographic}\s]+/u, '').trim()
  if (!t || t.length > 200) return false
  if (/\b(?:pay|call|buy|take|drink|stretch|meet|send|book|pack|carry|submit|renew)\b/i.test(t.split(/\s+/).slice(0, 2).join(' '))) return false
  return LOOKUP_VERB.test(t) && LOOKUP_SUBJECT.test(t)
}

const FUTURE_TIME = /\b(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)|every\s+(?:day|morning|evening|hour)|in\s+\d+\s+(?:minutes?|hours?))\b/i

/** 29 Oct live: "Check the India vs NZ match score at 9 pm on Friday" was answered now ("no match at that time")
 * instead of being scheduled. A lookup with a future time is a scheduled check: it becomes a reminder that does the
 * lookup when it fires. */
export function isScheduledLookup(text: string): boolean {
  const t = String(text || '').trim()
  return isLookupReminder(t.replace(FUTURE_TIME, ' ').replace(/\s+/g, ' ').trim()) && FUTURE_TIME.test(t)
}

/** A flight departure reminder that names its flight: "✈️ IndiGo 6E 5256 · Bengaluru → Mumbai departs in 3 hours". */
export function departureFlightCode(message: string): string {
  const t = String(message || '')
  if (!/\bdeparts?\b/i.test(t)) return ''
  const m = t.match(/\b([A-Z0-9]{2})\s?-?\s?(\d{2,4})\b(?=[^\n]*\bdeparts?\b)/)
  if (!m || /^\d{2}$/.test(m[1])) return ''
  return `${m[1]}${m[2]}`
}

type Fetch = typeof fetch

/** One short, sourced WhatsApp answer from a live web search. Null when nothing verifiable came back. */
export async function answerLookupReminder(message: string, opts: { now?: Date; timezone?: string; fetcher?: Fetch } = {}): Promise<string | null> {
  const apiKey = (globalThis as any).process?.env?.ANTHROPIC_API_KEY
  if (!apiKey) return null
  const now = opts.now || new Date()
  const tz = opts.timezone || 'Asia/Kolkata'
  const today = new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: tz }).format(now)
  const topic = String(message).replace(/^[\p{Extended_Pictographic}\s]+/u, '').replace(/^to\s+/i, '').trim()
  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'IN', timezone: tz } }],
    messages: [{ role: 'user', content: `Today is ${today}. The user asked to be updated on: "${topic}". Search for the latest news and reply for WhatsApp in at most 4 short lines: the current answer first (who leads or won, the score, the status, the number), then what changed, then one or two source names with links. If nothing current is reported, say so plainly. Never guess.` }],
  }
  try {
    const res = await (opts.fetcher || fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) { console.error('LOOKUP_REMINDER_FAILED:', res.status); return null }
    const data: any = await res.json()
    const text = (data?.content || []).filter((b: any) => b?.type === 'text').map((b: any) => String(b.text || '')).join('').trim()
    if (!text || text.length < 20) return null
    return text.slice(0, 1200)
  } catch (err: any) {
    console.error('LOOKUP_REMINDER_FAILED:', String(err?.message || err).slice(0, 120))
    return null
  }
}
