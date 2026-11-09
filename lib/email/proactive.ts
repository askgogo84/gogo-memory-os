// Proactive email (1 Nov live): the WhatsApp pulse pushed 4-5 emails twice an evening — AskGogo's own tips mail, a
// ResellerClub price notice, an IndiaFilings deadline that had already passed — next to the one that mattered (Vercel
// card failed). Gogo now pushes only email that clearly needs the person: at most 2 a day, each email once, judged
// by the same scorer and learned rules as the "emails that need me" card ("not important 1" teaches it). Pure.
import { scoreEmail, isOwnProductMail, whenLabel, type AttentionEmail, type AttentionRule, type ScoredEmail } from './attention'

/** Stricter than the on-demand card (0.6): only service cut-offs, security, bills due now, and people who need a decision. */
export const PROACTIVE_EMAIL_THRESHOLD = 0.75
export const PROACTIVE_EMAILS_PER_DAY = 2
/** Older email is not news; anything that truly needed the person has usually been seen by then. */
export const PROACTIVE_EMAIL_MAX_AGE_HOURS = 48

export type EmailLoop = {
  id: string
  kind?: string | null
  title?: string | null
  summary?: string | null
  source_type?: string | null
  source_id?: string | null
  evidence_json?: Record<string, any> | null
  created_at?: string | null
}

export type ProactiveEmail = ScoredEmail & { loopId: string; threadId: string | null }

export function isEmailLoop(loop: { source_type?: string | null }) {
  const type = String(loop?.source_type || '')
  return type === 'gmail_thread' || type === 'gmail_service_notice'
}

function clean(value: unknown, max = 600) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
/** "The deadline … is 29th October 2026" when that day is already over: old news, not an action. */
export function mentionsPassedDeadline(text: string, now = Date.now()) {
  const t = clean(text, 1200).toLowerCase()
  if (!/\b(?:deadline|due|last date|expir(?:es|y|ed))\b/.test(t)) return false
  const month = MONTHS.map(m => m.slice(0, 3)).join('|')
  const re = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${month})[a-z]*,?\\s+(20\\d\\d)\\b|\\b(${month})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, 'g')
  const dates: number[] = []
  for (const m of t.matchAll(re)) {
    const day = Number(m[1] || m[5]), mon = MONTHS.findIndex(x => x.startsWith(String(m[2] || m[4]))), year = Number(m[3] || m[6])
    if (mon >= 0 && day >= 1 && day <= 31) dates.push(Date.UTC(year, mon, day, 23, 59) - 330 * 60_000)
  }
  return dates.length > 0 && dates.every(d => d < now)
}

/** A company desk ("IndiaFilings Team", "Acme Support") writing like a person is still not a person waiting on you. */
const COMPANY_DESK = /\b(?:team|support|care|customer|service|services|helpdesk|desk|notifications?|compliance|billing|accounts|sales|marketing|newsletter|hr|admin|official)\b/i

/** The email an open loop was made from, rebuilt from what the loop stored (sender, subject, snippet, time). */
export function emailFromLoop(loop: EmailLoop): AttentionEmail | null {
  const ev = loop.evidence_json || {}
  const from = clean(ev.last_message_from || ev.sender, 240)
  if (!from) return null
  const title = clean(loop.title, 300)
  const dash = title.indexOf(' — ')
  const subject = dash >= 0 ? title.slice(dash + 3) : title
  const internal = Number(ev.last_internal_date)
  const internalDate = Number.isFinite(internal) && internal > 0 ? internal : (Date.parse(String(loop.created_at || '')) || null)
  return {
    id: String(ev.last_message_id || loop.source_id || loop.id),
    threadId: loop.source_id ? String(loop.source_id) : null,
    from,
    subject,
    snippet: clean(loop.summary, 500),
    internalDate,
    isUnread: ev.unread === true,
    source: 'gmail',
  }
}

/**
 * Which emails may interrupt the person now. Only incoming mail (never "waiting for a reply" on their own sent mail),
 * never AskGogo's own mail, never one already pushed, at most `cap - sentToday`, best first.
 */
export function selectProactiveEmails(loops: EmailLoop[], opts: {
  rules?: AttentionRule[]
  ownEmail?: string | null
  alreadySurfaced?: Set<string>
  sentToday?: number
  now?: number
  cap?: number
  threshold?: number
} = {}): ProactiveEmail[] {
  const now = opts.now ?? Date.now()
  const room = Math.max(0, (opts.cap ?? PROACTIVE_EMAILS_PER_DAY) - (opts.sentToday ?? 0))
  if (!room) return []
  const seen = opts.alreadySurfaced || new Set<string>()
  const threshold = opts.threshold ?? PROACTIVE_EMAIL_THRESHOLD
  const byThread = new Map<string, ProactiveEmail>()
  for (const loop of loops) {
    if (!isEmailLoop(loop)) continue
    if (String(loop.kind || '') === 'waiting_on') continue
    const threadKey = String(loop.source_id || loop.id)
    if (seen.has(`email:${threadKey}`) || seen.has(`open_loop:${loop.id}`)) continue
    const email = emailFromLoop(loop)
    if (!email || isOwnProductMail(email)) continue
    const at = Number(email.internalDate) || 0
    if (!at || now - at > PROACTIVE_EMAIL_MAX_AGE_HOURS * 3600_000 || at > now + 3600_000) continue
    const scored = scoreEmail(email, { rules: opts.rules || [], ownEmail: opts.ownEmail || null, now })
    if (scored.score < threshold) continue
    const always = scored.ruleApplied?.kind === 'always'
    if (!always && scored.category !== 'service_risk' && scored.category !== 'security' && mentionsPassedDeadline(`${email.subject} ${email.snippet}`, now)) continue
    if (!always && scored.category === 'person') {
      // A person only interrupts when they need a decision or something is due today or tomorrow.
      const urgent = scored.due === 'urgent' || scored.due === 'due today' || scored.due === 'due tomorrow'
      if (COMPANY_DESK.test(scored.senderName) || !(urgent || /Asks you to decide/.test(scored.why))) continue
    }
    const item: ProactiveEmail = { ...scored, loopId: String(loop.id), threadId: email.threadId || null }
    const prev = byThread.get(threadKey)
    if (!prev || item.score > prev.score) byThread.set(threadKey, item)
  }
  return [...byThread.values()].sort((a, b) => b.score - a.score).slice(0, room)
}

/** The same layout as the "emails that need me" card, so "draft 1" / "not important 1" bind to it on both surfaces. */
export function formatProactiveEmailCard(items: ProactiveEmail[], opts: { timezone?: string; now?: number } = {}) {
  const n = items.length
  const lines = [`📬 ${n} email${n === 1 ? ' needs' : 's need'} you`]
  items.forEach((s, i) => {
    const when = whenLabel(s.email, opts.timezone, opts.now)
    lines.push('', `${i + 1}. *${s.senderName}*${when ? ` · ${when}` : ''}`, s.ask, `Why: ${s.why}`)
  })
  lines.push('', `I only message you about email that clearly needs you, at most ${PROACTIVE_EMAILS_PER_DAY} a day. Reply "open 1" for the email, or "not important ${n}" and I'll learn.`)
  return lines.join('\n')
}
