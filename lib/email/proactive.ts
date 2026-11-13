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

export type ProactiveDecision = {
  loopId: string
  threadKey: string
  decision: 'pick' | 'skip'
  reason: 'picked' | 'over_daily_cap' | 'not_email' | 'waiting_on_reply' | 'already_surfaced' | 'no_sender' | 'own_product_mail' | 'too_old' | 'future_dated' | 'below_threshold' | 'deadline_passed' | 'person_not_urgent' | 'weaker_in_thread'
  item?: ProactiveEmail
  email?: AttentionEmail
  score?: number
  category?: string
}

/**
 * Every email loop with the decision the proactive pass makes about it and why (13 Nov: the shadow comparison logs
 * this next to Instinct). selectProactiveEmails is exactly the picks of this, so the two can never drift. Pure.
 */
export function explainProactiveEmails(loops: EmailLoop[], opts: {
  rules?: AttentionRule[]
  ownEmail?: string | null
  alreadySurfaced?: Set<string>
  sentToday?: number
  now?: number
  cap?: number
  threshold?: number
} = {}): ProactiveDecision[] {
  const now = opts.now ?? Date.now()
  const room = Math.max(0, (opts.cap ?? PROACTIVE_EMAILS_PER_DAY) - (opts.sentToday ?? 0))
  const seen = opts.alreadySurfaced || new Set<string>()
  const threshold = opts.threshold ?? PROACTIVE_EMAIL_THRESHOLD
  const out: ProactiveDecision[] = []
  const byThread = new Map<string, ProactiveDecision>()
  for (const loop of loops) {
    const threadKey = String(loop.source_id || loop.id)
    const base = { loopId: String(loop.id), threadKey }
    const skip = (reason: ProactiveDecision['reason'], extra: Partial<ProactiveDecision> = {}) => { out.push({ ...base, decision: 'skip', reason, ...extra }) }
    if (!isEmailLoop(loop)) { skip('not_email'); continue }
    if (String(loop.kind || '') === 'waiting_on') { skip('waiting_on_reply'); continue }
    if (seen.has(`email:${threadKey}`) || seen.has(`open_loop:${loop.id}`)) { skip('already_surfaced'); continue }
    const email = emailFromLoop(loop)
    if (!email) { skip('no_sender'); continue }
    if (isOwnProductMail(email)) { skip('own_product_mail', { email }); continue }
    const at = Number(email.internalDate) || 0
    if (!at || now - at > PROACTIVE_EMAIL_MAX_AGE_HOURS * 3600_000) { skip('too_old', { email }); continue }
    if (at > now + 3600_000) { skip('future_dated', { email }); continue }
    const scored = scoreEmail(email, { rules: opts.rules || [], ownEmail: opts.ownEmail || null, now })
    const facts = { email, score: scored.score, category: scored.category }
    if (scored.score < threshold) { skip('below_threshold', facts); continue }
    const always = scored.ruleApplied?.kind === 'always'
    if (!always && scored.category !== 'service_risk' && scored.category !== 'security' && mentionsPassedDeadline(`${email.subject} ${email.snippet}`, now)) { skip('deadline_passed', facts); continue }
    if (!always && scored.category === 'person') {
      // A person only interrupts when they need a decision or something is due today or tomorrow.
      const urgent = scored.due === 'urgent' || scored.due === 'due today' || scored.due === 'due tomorrow'
      if (COMPANY_DESK.test(scored.senderName) || !(urgent || /Asks you to decide/.test(scored.why))) { skip('person_not_urgent', facts); continue }
    }
    const item: ProactiveEmail = { ...scored, loopId: String(loop.id), threadId: email.threadId || null }
    const decided: ProactiveDecision = { ...base, decision: 'pick', reason: 'picked', item, ...facts }
    const prev = byThread.get(threadKey)
    if (!prev) byThread.set(threadKey, decided)
    else if (item.score > (prev.item?.score ?? -1)) { out.push({ ...prev, decision: 'skip', reason: 'weaker_in_thread' }); byThread.set(threadKey, decided) }
    else out.push({ ...decided, decision: 'skip', reason: 'weaker_in_thread' })
  }
  const ranked = [...byThread.values()].sort((a, b) => (b.item!.score) - (a.item!.score))
  ranked.forEach((d, i) => out.push(i < room ? d : { ...d, decision: 'skip', reason: 'over_daily_cap' }))
  return out
}

/**
 * Which emails may interrupt the person now. Only incoming mail (never "waiting for a reply" on their own sent mail),
 * never AskGogo's own mail, never one already pushed, at most `cap - sentToday`, best first.
 */
export function selectProactiveEmails(loops: EmailLoop[], opts: Parameters<typeof explainProactiveEmails>[1] = {}): ProactiveEmail[] {
  return explainProactiveEmails(loops, opts).filter(d => d.decision === 'pick').map(d => d.item!).sort((a, b) => b.score - a.score)
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
