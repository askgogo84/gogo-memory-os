// Email attention: decide which emails need the person, say why in a few words, and learn from their taps.
// Pure functions only (no I/O) so every source (Gmail, forwarded inbox, Composio) is scored the same way.

export type AttentionEmail = {
  id: string
  threadId?: string | null
  messageId?: string | null
  from: string
  to?: string | null
  subject: string
  snippet: string
  internalDate?: number | null
  date?: string | null
  labelIds?: string[]
  isUnread?: boolean
  listId?: string | null
  listUnsubscribe?: string | null
  precedence?: string | null
  autoSubmitted?: string | null
  source?: 'gmail' | 'forwarded' | 'composio'
}

export type AttentionRule = {
  id?: string
  kind: 'always' | 'never'
  matchType: 'sender' | 'domain' | 'sender_category'
  matchValue: string
  category?: string | null
  label: string
  source: 'feedback' | 'chat' | 'behaviour' | 'built_in'
}

export type AttentionCategory =
  | 'person' | 'bill_due' | 'service_risk' | 'security' | 'order_update' | 'receipt'
  | 'newsletter' | 'promotion' | 'social' | 'otp' | 'transaction_alert' | 'update'

export type ScoredEmail = {
  email: AttentionEmail
  category: AttentionCategory
  score: number
  picked: boolean
  why: string
  ask: string
  due: string | null
  senderName: string
  senderEmail: string
  ruleApplied: AttentionRule | null
}

export const ATTENTION_THRESHOLD = 0.6
export const MAX_PICKED = 3

function clean(value: unknown, max = 600) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function senderEmailOf(from: unknown) {
  const m = String(from || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  return m ? m[0].toLowerCase() : ''
}

export function senderDomainOf(from: unknown) {
  const email = senderEmailOf(from)
  const host = email.split('@')[1] || ''
  // "alerts.hdfcbank.net" and "hdfcbank.net" are one sender for learning purposes.
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const tail2 = parts.slice(-2).join('.')
  return /^(?:co|com|net|org|gov|ac)\.[a-z]{2}$/.test(tail2) ? parts.slice(-3).join('.') : tail2
}

export function senderNameOf(from: unknown) {
  const raw = clean(from, 200)
  const name = raw.split('<')[0]?.replace(/^["']|["']$/g, '').trim()
  if (name && !/@/.test(name)) return name.slice(0, 40)
  const email = senderEmailOf(raw)
  const local = email.split('@')[0] || ''
  const domain = senderDomainOf(raw).split('.')[0] || ''
  const base = /^(?:no-?reply|info|hello|support|alerts?|notifications?|mailer|team|news)$/i.test(local) ? domain : local
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 40) || 'Someone'
}

function firstName(name: string) {
  return name.split(/\s+/)[0] || name
}

const AUTOMATED_LOCAL = /(?:^|[._+-])(no-?reply|do-?not-?reply|newsletter|digest|notifications?|alerts?|instaalerts?|mailers?|marketing|promotions?|offers|updates|feedback|surveys?|bounces?|info|news|hello|team|support|orders?|billing|statements?)(?:[._+-]|@)/i
const PROBLEM = /\b(?:refund|failed|declined|problem|issue|cancel(?:led|ed|lation)|delayed|undeliver|returned|dispute|chargeback|suspicious|unusual|blocked|locked|compromised)\b/i

function isBulk(email: AttentionEmail) {
  const labels = email.labelIds || []
  if (clean(email.listId)) return true
  if (clean(email.listUnsubscribe)) return true
  if (/\b(?:bulk|list|junk)\b/i.test(clean(email.precedence, 80))) return true
  const auto = clean(email.autoSubmitted, 80).toLowerCase()
  if (auto && auto !== 'no') return true
  return labels.some(l => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'].includes(l))
}

function isAutomatedSender(email: AttentionEmail) {
  return AUTOMATED_LOCAL.test(senderEmailOf(email.from)) || isBulk(email) || (email.labelIds || []).includes('CATEGORY_UPDATES')
}

export function classifyEmail(email: AttentionEmail): AttentionCategory {
  const text = clean(`${email.subject} ${email.snippet}`, 1200)
  const labels = email.labelIds || []
  if (/\bone[- ]time password\b|\bOTP\b|\bverification code\b|\bsign[- ]?in code\b|\blogin code\b/i.test(text)) return 'otp'
  if (/\b(?:payment\s+(?:failed|declined)|billing\s+(?:failed|overdue)|overdue\s+invoice)\b/i.test(text)
    && /\b(?:shutdown|shut\s*down|suspend(?:ed|ing)?|suspension|service\s+interruption|action\s+required|disconnect)\b/i.test(text)) return 'service_risk'
  if (/\b(?:suspicious|unusual)\s+(?:sign[- ]?in|login|activity)\b|\bpassword (?:was )?changed\b|\baccount (?:locked|compromised)\b/i.test(text)) return 'security'
  if (/\b(?:bill|statement|payment|emi|premium|dues?|invoice)\b.{0,60}\b(?:due|overdue|pay by|last date)\b|\bdue (?:date|on|by|tomorrow|today)\b.{0,60}\b(?:bill|payment|amount|card|emi|premium|invoice)\b|\b(?:minimum|total) amount due\b/i.test(text)
    && !/\b(?:paid|received your payment|payment received|thank you for (?:your )?payment|successful)\b/i.test(text)) return 'bill_due'
  if (/\b(?:debited|credited)\b.{0,80}\b(?:a\/c|account|card|upi)\b|\b(?:a\/c|account|card)\b.{0,80}\b(?:debited|credited)\b/i.test(text)) return 'transaction_alert'
  if (labels.includes('CATEGORY_PROMOTIONS') || /\b(?:% off|sale|offer|deal|coupon|promo code|cashback|limited time|exclusive)\b/i.test(text) && isAutomatedSender(email)) return 'promotion'
  if (labels.includes('CATEGORY_SOCIAL') || /^(?:linkedin\.com|facebookmail\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|quora\.com)$/i.test(senderDomainOf(email.from))) return 'social'
  if (/\b(?:order|delivery|shipment|shipped|out for delivery|delivered|dispatched|arriving)\b/i.test(text) && isAutomatedSender(email)) return 'order_update'
  if (/\b(?:receipt|invoice|payment received|thank you for (?:your )?(?:payment|order)|order confirmed|booking confirmed)\b/i.test(text) && isAutomatedSender(email)) return 'receipt'
  if (clean(email.listId) || clean(email.listUnsubscribe) || /\b(?:newsletter|digest|weekly|unsubscribe)\b/i.test(text)) return 'newsletter'
  if (isAutomatedSender(email)) return 'update'
  return 'person'
}

const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export function dueHint(text: string): string | null {
  const t = clean(text, 1200)
  if (/\b(?:today|tonight|eod|end of (?:the )?day|asap|immediately|urgent(?:ly)?)\b/i.test(t)) return /\burgent|asap|immediately/i.test(t) ? 'urgent' : 'due today'
  if (/\btomorrow\b/i.test(t)) return 'due tomorrow'
  const day = t.match(/\b(?:by|before|on|until|till|due)\s+(?:this\s+|next\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i)
  if (day) return `due ${day[1].charAt(0).toUpperCase()}${day[1].slice(1, 3).toLowerCase()}`
  const date = t.match(/\b(?:by|before|on|due(?: date)?:?|pay by|last date:?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i)
    || t.match(/\b(?:by|before|due(?: date)?:?|pay by|last date:?)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i)
  if (date) {
    const [d, m] = /\d/.test(date[1]) ? [date[1], date[2]] : [date[2], date[1]]
    return `due ${Number(d)} ${m.charAt(0).toUpperCase()}${m.slice(1, 3).toLowerCase()}`
  }
  return null
}

const DECIDE = /\b(?:approve|approval|sign[- ]?off|sign (?:it|the)|decide|decision|confirm|go[- ]ahead|your call|permission|authori[sz]e)\b/i
const ASK = /\?|\b(?:please|kindly|could you|can you|would you|need you to|let me know|your (?:feedback|thoughts|input|review)|review|reply|respond|revert|send (?:me|us)|share|provide|submit|complete|fill)\b/i
const PROMISE = /\b(?:i(?:'ll| will)|we(?:'ll| will))\s+(?:send|share|get back|revert|update|call)\b/i

function stripSubject(subject: string) {
  return clean(subject, 200).replace(/^(?:(?:re|fwd?|fw)\s*:\s*)+/i, '').trim() || '(no subject)'
}

// One readable line: the sentence that carries the ask, else the subject.
export function askLine(email: AttentionEmail, category: AttentionCategory) {
  const subject = stripSubject(email.subject)
  const snippet = clean(email.snippet, 600).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  if (category === 'person') {
    const sentences = snippet.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(s => s.length > 12 && !/^(?:hi|hello|dear|hey)\b[^.?!]{0,30}[,!.]?$/i.test(s))
    const ask = sentences.find(s => DECIDE.test(s) || ASK.test(s))
    if (ask) { const line = ask.replace(/^(?:hi|hello|dear|hey)\s+[a-z]+[,!]?\s*/i, '').slice(0, 140); return line.charAt(0).toUpperCase() + line.slice(1) }
  }
  if (category === 'bill_due') {
    const amount = snippet.match(/(?:₹|rs\.?|inr)\s?[\d,]+(?:\.\d{1,2})?/i)?.[0]
    return `${subject}${amount && !subject.includes(amount) ? ` · ${amount.replace(/^(?:rs\.?|inr)\s?/i, '₹')}` : ''}`.slice(0, 140)
  }
  return subject.slice(0, 140)
}

function ruleMatches(rule: AttentionRule, email: AttentionEmail, category: AttentionCategory) {
  const v = rule.matchValue.toLowerCase()
  if (rule.matchType === 'sender') return senderEmailOf(email.from) === v || senderNameOf(email.from).toLowerCase() === v
  if (rule.matchType === 'domain') return senderDomainOf(email.from) === v || senderEmailOf(email.from).endsWith(`@${v}`)
  return senderDomainOf(email.from) === v && (!rule.category || rule.category === category)
}

export function findRule(rules: AttentionRule[], email: AttentionEmail, category: AttentionCategory) {
  // "Never" is checked after "always" so an explicit always-flag wins; a problem email
  // (refund, failure, suspicious sign-in) is never silenced by a "not important" tap on routine updates.
  const always = rules.find(r => r.kind === 'always' && ruleMatches(r, email, category))
  if (always) return always
  const never = rules.find(r => r.kind === 'never' && ruleMatches(r, email, category))
  if (never && PROBLEM.test(`${email.subject} ${email.snippet}`) && category !== 'person') return null
  return never || null
}

export type ScoreContext = {
  rules?: AttentionRule[]
  ownEmail?: string | null
  // Senders the person has written to recently: their mail matters more.
  repliedSenders?: Set<string>
  now?: number
}

export function scoreEmail(email: AttentionEmail, ctx: ScoreContext = {}): ScoredEmail {
  const now = ctx.now ?? Date.now()
  const category = classifyEmail(email)
  const text = clean(`${email.subject} ${email.snippet}`, 1200)
  const senderEmail = senderEmailOf(email.from)
  const senderName = senderNameOf(email.from)
  const due = dueHint(text)
  const rule = findRule(ctx.rules || [], email, category)
  const reasons: string[] = []
  let score = 0

  const own = Boolean(ctx.ownEmail && senderEmail === String(ctx.ownEmail).toLowerCase())
  if (own || category === 'otp' || category === 'transaction_alert') score = 0
  else if (category === 'service_risk') { score = 0.92; reasons.push('Service may be cut off') }
  else if (category === 'security') { score = 0.8; reasons.push('Security alert on your account') }
  else if (category === 'bill_due') {
    score = 0.66
    if (due === 'due today' || due === 'due tomorrow' || due === 'urgent') score += 0.2
    reasons.push(due ? `Payment ${due}` : 'Payment due')
  } else if (category === 'person') {
    const decide = DECIDE.test(text)
    const ask = ASK.test(text) && !(PROMISE.test(text) && !/\?/.test(text))
    score = decide ? 0.68 : ask ? 0.6 : 0.3
    if (decide) reasons.push('Asks you to decide')
    else if (ask) reasons.push(/\?/.test(text) ? 'Asks you a question' : 'Asks for a reply')
    if (due) { score += due === 'urgent' || due === 'due today' ? 0.2 : 0.12; reasons.push(due) }
    if (ctx.repliedSenders?.has(senderEmail)) { score += 0.12; if (reasons.length < 2) reasons.push(`You often reply to ${firstName(senderName)}`) }
    if (email.isUnread) score += 0.04
  } else if (PROBLEM.test(text) && (category === 'order_update' || category === 'update' || category === 'receipt')) {
    score = 0.62; reasons.push('Something went wrong')
  } else score = category === 'order_update' || category === 'update' ? 0.15 : 0.05

  if (rule?.kind === 'always' && score > 0) { score = Math.max(score, 0.7) + 0.1; reasons.unshift(rule.source === 'built_in' ? rule.label : `You flagged ${rule.label}`) }
  if (rule?.kind === 'never') score = Math.min(score, 0.2)

  // Older mail fades: anything that truly needed you this week has usually been seen.
  const at = Number(email.internalDate) || Date.parse(String(email.date || '')) || now
  const ageDays = (now - at) / 86400_000
  if (ageDays > 10) score *= 0.3
  else if (ageDays > 5) score *= 0.75

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))))
  const why = [...new Set(reasons)].slice(0, 2).join(' · ') || 'Looks important'
  return { email, category, score, picked: score >= ATTENTION_THRESHOLD, why, ask: askLine(email, category), due, senderName, senderEmail, ruleApplied: rule }
}

const SKIP_LABEL: Record<string, [string, string]> = {
  newsletter: ['newsletter', 'newsletters'], promotion: ['promotion', 'promotions'], receipt: ['receipt', 'receipts'],
  order_update: ['order update', 'order updates'], update: ['update', 'updates'], social: ['social', 'social'],
  otp: ['code', 'codes'], transaction_alert: ['bank alert', 'bank alerts'], person: ['personal note', 'personal notes'],
  bill_due: ['bill', 'bills'], security: ['alert', 'alerts'], service_risk: ['notice', 'notices'],
}

export type AttentionPick = { picked: ScoredEmail[]; skipped: ScoredEmail[]; checked: number }

export function pickAttention(emails: AttentionEmail[], ctx: ScoreContext = {}, max = MAX_PICKED): AttentionPick {
  // One entry per thread (latest message wins) so a long back-and-forth is one item.
  const byThread = new Map<string, AttentionEmail>()
  for (const e of emails) {
    const key = String(e.threadId || e.messageId || e.id)
    const prev = byThread.get(key)
    if (!prev || (Number(e.internalDate) || 0) >= (Number(prev.internalDate) || 0)) byThread.set(key, e)
  }
  const scored = [...byThread.values()].map(e => scoreEmail(e, ctx)).sort((a, b) => b.score - a.score)
  const picked = scored.filter(s => s.picked).slice(0, max)
  return { picked, skipped: scored.filter(s => !picked.includes(s)), checked: scored.length }
}

export function skippedSummary(skipped: ScoredEmail[]) {
  if (!skipped.length) return ''
  const counts = new Map<string, number>()
  for (const s of skipped) counts.set(s.category, (counts.get(s.category) || 0) + 1)
  const parts = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat, n]) => `${n} ${(SKIP_LABEL[cat] || [cat, cat])[n === 1 ? 0 : 1]}`)
  return `Skipped ${skipped.length}: ${parts.join(', ')}`
}

export function whenLabel(email: AttentionEmail, timezone = 'Asia/Kolkata', now = Date.now()) {
  const at = Number(email.internalDate) || Date.parse(String(email.date || ''))
  if (!Number.isFinite(at) || at <= 0) return ''
  let tz = timezone
  try { new Intl.DateTimeFormat('en-IN', { timeZone: tz }) } catch { tz = 'Asia/Kolkata' }
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  if (day(at) === day(now)) return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(at)).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase()
  if (day(at) === day(now - 86400_000)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(at))
}

export const ATTENTION_CARD_HEADING = /^📬 (?:(\d+) emails? needs? you|Nothing in your email needs you)/

// The chat card. Plain text that reads well on WhatsApp; the dashboard parses the same text into a card with buttons.
export function formatAttentionCard(pick: AttentionPick, opts: { timezone?: string; now?: number; greeting?: string } = {}) {
  const lines: string[] = []
  const n = pick.picked.length
  if (!n) {
    lines.push(`📬 Nothing in your email needs you right now.`)
    if (pick.skipped.length) lines.push(skippedSummary(pick.skipped))
    return lines.join('\n')
  }
  lines.push(`📬 ${n} email${n === 1 ? ' needs' : 's need'} you`)
  if (pick.skipped.length) lines.push(skippedSummary(pick.skipped))
  pick.picked.forEach((s, i) => {
    const when = whenLabel(s.email, opts.timezone, opts.now)
    lines.push('', `${i + 1}. *${s.senderName}*${when ? ` · ${when}` : ''}`, s.ask, `Why: ${s.why}`)
  })
  const first = 1, last = n
  lines.push('', `Reply "draft ${first}", "remind ${first}" or "not important ${last}". I learn from what you mark.`)
  return lines.join('\n')
}

export type ParsedAttentionCard = {
  count: number
  skipped: string
  items: Array<{ index: number; sender: string; when: string; ask: string; why: string }>
}

export function parseAttentionCard(text: string): ParsedAttentionCard | null {
  const raw = String(text || '')
  const head = raw.match(ATTENTION_CARD_HEADING)
  if (!head) return null
  const skipped = raw.match(/^Skipped \d+:[^\n]*/m)?.[0] || ''
  const items: ParsedAttentionCard['items'] = []
  const re = /^(\d)\. \*([^*\n]+)\*(?: · ([^\n]+))?\n([^\n]+)\nWhy: ([^\n]+)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) items.push({ index: Number(m[1]), sender: m[2], when: m[3] || '', ask: m[4], why: m[5] })
  return { count: head[1] ? Number(head[1]) : 0, skipped, items }
}

// What a "not important" tap teaches: a person's address, or a company's routine category.
export function ruleFromFeedback(s: Pick<ScoredEmail, 'category' | 'senderEmail' | 'senderName'> & { email: Pick<AttentionEmail, 'from'> }, kind: 'always' | 'never'): AttentionRule {
  const domain = senderDomainOf(s.email.from)
  if (s.category === 'person' || !domain) return { kind, matchType: 'sender', matchValue: s.senderEmail || s.senderName.toLowerCase(), label: `mail from ${s.senderName}`, source: 'feedback' }
  const cat = SKIP_LABEL[s.category]?.[1] || 'mail'
  if (kind === 'always') return { kind, matchType: 'domain', matchValue: domain, label: `mail from ${s.senderName}`, source: 'feedback' }
  return { kind, matchType: 'sender_category', matchValue: domain, category: s.category, label: `${s.senderName} ${cat}`, source: 'feedback' }
}
