// Important mail, one WhatsApp message at a time (owner-approved mock, 6 Nov; the Dots pattern). Replaces the
// 4-hourly inbox digest: each email that needs the person becomes its own short message, with what Gogo knows
// from the calendar and saved trips, sent once. Payments that failed, money leaving, deadlines inside an email,
// security notices and replies waiting on them. Orders have their own path (lib/agent/order-tracking.ts).
// Quiet 10 pm to 8 am, at most 6 a day; everything else waits for "any important emails?". Read-only.
import { classifyEmail, scoreEmail, senderNameOf, type AttentionEmail, type AttentionRule, type ScoredEmail } from './attention'

export const ALERT_KINDS = ['payment_failed', 'money_leaving', 'deadline', 'security', 'reply_waiting', 'newsletter'] as const
export type AlertKind = typeof ALERT_KINDS[number]
export type MailAlertRules = { kinds: Record<AlertKind, boolean>; quietStart: number; quietEnd: number; maxPerDay: number }
export const DEFAULT_RULES: MailAlertRules = {
  kinds: { payment_failed: true, money_leaving: true, deadline: true, security: true, reply_waiting: true, newsletter: false },
  quietStart: 22, quietEnd: 8, maxPerDay: 6,
}
export const KIND_LABEL: Record<AlertKind, { label: string; sub: string; words: RegExp }> = {
  payment_failed: { label: 'Payments failed or declined', sub: 'card declines, failed autopay, unpaid invoices', words: /\b(?:failed|declined?|unpaid|payment\s+fail\w*)\b/i },
  money_leaving: { label: 'Money leaving', sub: 'large charges, new mandates, renewals', words: /\b(?:money|charges?|mandates?|renewals?|renewing|subscriptions?)\b/i },
  deadline: { label: 'Deadlines in an email', sub: 'links that expire, forms, interviews', words: /\b(?:deadlines?|expir\w*|interviews?|forms?)\b/i },
  security: { label: 'Security notices', sub: 'new sign-ins, apps given access, password changes', words: /\b(?:security|sign[- ]?ins?|logins?|passwords?)\b/i },
  reply_waiting: { label: 'Replies waiting on you', sub: 'people, not newsletters', words: /\b(?:repl(?:y|ies)|people|questions?)\b/i },
  newsletter: { label: 'Newsletters and offers', sub: '', words: /\b(?:newsletters?|offers?|promotions?|deals?)\b/i },
}

export function normalizeRules(input: any): MailAlertRules {
  const kinds = { ...DEFAULT_RULES.kinds }
  for (const k of ALERT_KINDS) if (typeof input?.kinds?.[k] === 'boolean') kinds[k] = input.kinds[k]
  const hour = (v: any, d: number) => Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23 ? Number(v) : d
  const max = Number(input?.maxPerDay)
  return { kinds, quietStart: hour(input?.quietStart, 22), quietEnd: hour(input?.quietEnd, 8), maxPerDay: Number.isInteger(max) && max >= 1 && max <= 20 ? max : 6 }
}

/** "stop renewals", "add newsletters", "turn off replies", "quiet from 11 pm", "max 3 a day". Pure. */
export function applyRuleCommand(text: string, rules: MailAlertRules): { rules: MailAlertRules; changed: string } | null {
  const t = String(text || '').trim()
  if (t.length > 120) return null
  const m = t.match(/^\s*(?:please\s+)?(stop|mute|turn\s+off|disable|no\s+more|don'?t\s+alert\s+(?:me\s+)?(?:about|on|for)|add|start|turn\s+on|enable|alert\s+me\s+(?:about|on|for))\s+(?:me\s+)?(?:about\s+|on\s+|for\s+)?(?:the\s+)?([a-z][a-z\s-]{2,40}?)\s*(?:alerts?|messages?|mails?|emails?)?\s*[.!]*$/i)
  if (m) {
    const on = /^(?:add|start|turn\s+on|enable|alert)/i.test(m[1])
    const kind = ALERT_KINDS.find(k => KIND_LABEL[k].words.test(m[2]))
    if (!kind) return null
    if (rules.kinds[kind] === on) return { rules, changed: `${KIND_LABEL[kind].label} alerts were already ${on ? 'on' : 'off'}.` }
    return { rules: { ...rules, kinds: { ...rules.kinds, [kind]: on } }, changed: `${KIND_LABEL[kind].label}: ${on ? 'on' : 'off'}.` }
  }
  const q = t.match(/^\s*quiet\s+(?:hours?\s+)?(?:from\s+)?(\d{1,2})\s*(am|pm)?\s*(?:to|-|until|till)\s*(\d{1,2})\s*(am|pm)?\s*$/i)
  if (q) {
    const h = (n: string, ap?: string) => { let v = Number(n) % 12; if ((ap || '').toLowerCase() === 'pm') v += 12; if (!ap && Number(n) > 12) v = Number(n); return v }
    const quietStart = h(q[1], q[2]), quietEnd = h(q[3], q[4])
    return { rules: { ...rules, quietStart, quietEnd }, changed: `Quiet ${hourLabel(quietStart)} to ${hourLabel(quietEnd)}.` }
  }
  const n = t.match(/^\s*(?:at\s+most|max(?:imum)?|up\s+to)\s+(\d{1,2})\s+(?:alerts?\s+)?(?:a|per)\s+day\s*$/i)
  if (n) { const maxPerDay = Math.max(1, Math.min(20, Number(n[1]))); return { rules: { ...rules, maxPerDay }, changed: `At most ${maxPerDay} a day.` } }
  return null
}

export const RULES_ASK_RE = /^\s*(?:what\s+(?:do|will|would)\s+you\s+(?:alert|message|ping|notify)\s+me\s+(?:about|on|for)|what\s+(?:mail|email)s?\s+(?:do\s+you\s+)?(?:alert|flag)|(?:my\s+)?(?:mail|email)\s+alert\s+(?:settings?|rules?)|which\s+emails?\s+(?:do|will)\s+you\s+(?:alert|flag))\b[\s?]*$/i
export const RULE_COMMAND_RE = /^\s*(?:please\s+)?(?:stop|mute|turn\s+off|disable|no\s+more|don'?t\s+alert|add|start|turn\s+on|enable|alert\s+me\s+(?:about|on|for)|quiet\s+(?:hours?\s+)?(?:from\s+)?\d|at\s+most\s+\d|max(?:imum)?\s+\d|up\s+to\s+\d)/i

export function hourLabel(h: number) { const x = ((h % 24) + 24) % 24; return x === 0 ? '12 am' : x === 12 ? '12 pm' : x < 12 ? `${x} am` : `${x - 12} pm` }

/** The settings reply (mock screen 3). Pure. */
export function formatRules(r: MailAlertRules) {
  const lines = ALERT_KINDS.map(k => `• ${KIND_LABEL[k].label} · ${r.kinds[k] ? 'on' : 'off'}${KIND_LABEL[k].sub && r.kinds[k] ? `\n  ${KIND_LABEL[k].sub}` : ''}`)
  return `One message per email, only for these. Say "stop renewals" or "add newsletters" to change it.\n\n${lines.join('\n')}\n\nQuiet ${hourLabel(r.quietStart)} to ${hourLabel(r.quietEnd)}, at most ${r.maxPerDay} a day. Anything else waits for "any important emails?".`
}

// ── classification ──────────────────────────────────────────────────────────────
const FAILED = /\b(?:payment|charge|transaction|autopay|auto-?debit|mandate|e-?nach|si)\b.{0,60}\b(?:failed|declined|unsuccessful|could\s*n[o']t\s+be\s+(?:processed|completed)|was\s+not\s+successful|bounced)\b|\b(?:failed|declined|unsuccessful)\b.{0,40}\b(?:payment|charge|transaction|autopay)\b|\binsufficient\s+(?:funds|balance)\b|\bunpaid\s+invoice\b|\bpayment\s+(?:is\s+)?(?:overdue|past\s+due)\b/i
const RENEW = /\b(?:renew(?:s|al|ing|ed)?|auto-?renew\w*|subscription\s+(?:will|is)\b|membership\s+(?:will|is)\b|plan\s+(?:will|is)\s+renew\w*|will\s+be\s+charged|next\s+billing|upcoming\s+(?:charge|payment|bill))\b/i
const MANDATE = /\b(?:new\s+)?(?:recurring[- ]payment\s+)?mandate\b|\bautopay\b.{0,30}\b(?:registered|set\s*up|created|activated)\b|\bstanding\s+instruction\b/i
const CONFIRM_CHARGE = /\b(?:confirm|authori[sz]e|verify|approve)\b.{0,50}\b(?:payment|charge|transaction|purchase)\b|\b(?:did\s+you|was\s+this\s+you)\b.{0,40}\b(?:authori[sz]e|make|charge)\b/i
const DEADLINE = /\b(?:expires?|expiring|expiry|valid\s+(?:till|until|for)|last\s+date|deadline|closes?\s+on|due\s+(?:by|on|date)|respond\s+by|reply\s+by|within\s+\d+\s+(?:hours?|days?)|before\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i
const DEADLINE_SUBJECT = /\b(?:interview|assessment|assignment|offer|verification|verify|application|visa|appointment|renewal\s+due|kyc|re-?kyc|nomination|e-?sign|signature)\b/i
const SECURITY = /\b(?:granted\s+access|allowed\s+\S+\s+access|was\s+given\s+access|has\s+access\s+to\s+your|third[- ]party\s+access|connected\s+app|new\s+(?:sign[- ]?in|login|device)|signed\s+in\s+(?:from|on)\s+a\s+new|unusual\s+(?:sign[- ]?in|activity)|password\s+(?:was\s+)?(?:changed|reset)|recovery\s+(?:phone|email)\s+(?:was\s+)?(?:changed|added)|2[- ]?step\s+verification\s+(?:turned|was)|security\s+alert)\b/i
const AMOUNT = /(?:₹|\brs\.?|\binr)\s?([\d,]+(?:\.\d{1,2})?)|(?:\busd\s?|\$)([\d,]+(?:\.\d{1,2})?)/i
// Large bank transactions are not necessarily spending: the attention classifier puts
// BOTH credited and debited bank messages in "transaction_alert". Require explicit
// outgoing evidence for the large-amount fallback; ambiguous mixed-direction mail
// must not be presented as "Money leaving". Mandate notices retain their own rule.
const OUTGOING_TRANSACTION = /\b(?:debited|debit(?:ed)?\s+(?:from|of|to)|charged|withdrawn|withdrawal|spent|transferred\s+from|paid\s+to)\b/i
const INCOMING_TRANSACTION = /\b(?:credited|credit\s+to|refund(?:ed)?|cashback|salary|deposited|deposit(?:\s+received)?|payment\s+received|received\s+(?:a\s+)?(?:payment|transfer))\b/i
/** Bills under this (in rupees) never get their own message. */
export const SMALL_BILL = 500

export function amountOf(text: string): { value: number; text: string } | null {
  const m = String(text || '').match(AMOUNT)
  if (!m) return null
  const raw = m[1] || m[2]
  const value = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(value) || value <= 0) return null
  return { value: m[1] ? value : value * 84, text: m[1] ? `₹${raw}` : `$${raw}` }
}

/** An email can mention a ₹100 late fee before its ₹24,000 balance.
 * Prefer the explicitly labelled bill total; never guess from multiple unlabeled amounts.
 */
const ALL_AMOUNTS = new RegExp(AMOUNT.source, 'gi')
const BILL_AMOUNT_LABEL = new RegExp(
  '\\b(?:total\\s+amount\\s+due|amount\\s+due|balance\\s+due|total\\s+(?:amount|bill)|outstanding\\s+(?:amount|balance)|amount\\s+payable|payment\\s+due|bill\\s+(?:of|for)|invoice\\s+(?:of|for))\\s*(?::|is|of|=)?\\s*(' + AMOUNT.source + ')',
  'i',
)
function mentionedAmounts(text: string): { value: number; text: string }[] {
  return Array.from(String(text || '').matchAll(ALL_AMOUNTS), m => amountOf(m[0]))
    .filter((v): v is { value: number; text: string } => v !== null)
}
export function billAmountOf(text: string): { value: number; text: string } | null {
  const source = String(text || '')
  const explicit = source.match(BILL_AMOUNT_LABEL)
  if (explicit) return amountOf(explicit[1])
  const amounts = mentionedAmounts(source)
  return amounts.length === 1 ? amounts[0] : null
}

// A founder-signed onboarding or drip mail ("Thanks for signing up for Cofounder. I'm Cooper… sign up here", 8 Nov) comes
// from a person's name with no list headers, so it scores as a person. It is not someone waiting on a reply.
const ONBOARDING = /\bthanks?\s+(?:you\s+)?for\s+(?:signing\s+up|joining|registering|subscribing|trying|creating\s+(?:an|your)\s+account|your\s+interest)\b|\bwelcome\s+(?:to|aboard)\b|\b(?:just\s+)?sign\s+up\s+here\b|\bbook\s+(?:a|some)\s+(?:time|call|slot|demo)\b|\b(?:grab|pick)\s+a\s+(?:time|slot)\b|\bcalendly\.com\b|\bcal\.com\/|\b(?:i|we)\s+meet\s+with\s+(?:users|customers|founders)\b|\bhelp\s+(?:you\s+)?get\s+(?:started|the\s+most)\b|\bget\s+started\s+with\b|\bfree\s+trial\b|\bunsubscribe\b/i

/** Which alert an email is, or null when it should wait for "any important emails?". Pure. */
export function alertKindOf(s: ScoredEmail): AlertKind | null {
  const e = s.email, text = `${e.subject} ${e.snippet}`.replace(/\s+/g, ' ')
  const c = s.category
  if (c === 'otp' || c === 'social' || c === 'order_update') return null
  if (s.score === 0 && c !== 'transaction_alert') return null // the person's own mail, or AskGogo's own digests
  if (c === 'newsletter' || c === 'promotion') return 'newsletter'
  if (c === 'security' || SECURITY.test(text)) return 'security'
  if (c === 'service_risk' || FAILED.test(text)) return 'payment_failed'
  if (c === 'bill_due') {
    // A ₹15 "Payment Reminder" (Amazon Pay, 6 Nov) is not money worth a message; it waits for "any important emails?".
    const amt = billAmountOf(text)
    if (amt) return amt.value < SMALL_BILL ? null : 'money_leaving'
    // A small late fee must not silence an unlabeled, larger payable.
    const amounts = mentionedAmounts(text)
    return amounts.length > 0 && amounts.every(a => a.value < SMALL_BILL) ? null : 'money_leaving'
  }
  if (c === 'transaction_alert') {
    const amt = amountOf(text)
    const outgoing = OUTGOING_TRANSACTION.test(text) && !INCOMING_TRANSACTION.test(text)
    return MANDATE.test(text) || (amt && amt.value >= 10_000 && outgoing) ? 'money_leaving' : null
  }
  if (c === 'receipt' || c === 'update') {
    if (CONFIRM_CHARGE.test(text) || MANDATE.test(text)) return 'money_leaving'
    if (RENEW.test(text) && amountOf(text)) return 'money_leaving'
    if (DEADLINE.test(text) && DEADLINE_SUBJECT.test(text)) return 'deadline'
    return null
  }
  if (c === 'person') {
    // A renewal notice signed by a person (an account manager) is still money leaving.
    if (RENEW.test(text) && amountOf(text)) return 'money_leaving'
    if (DEADLINE.test(text) && DEADLINE_SUBJECT.test(text)) return 'deadline'
    if (ONBOARDING.test(text)) return null
    return s.score >= 0.6 ? 'reply_waiting' : null
  }
  return null
}

// ── context and wording ──────────────────────────────────────────────────────────
export type TodayEvent = { summary: string; start: string; end?: string; attendees?: { email: string }[] }
export type Trip = { fromCity?: string | null; toCity?: string | null; departAt: string; returnAt?: string | null }
export type AlertContext = { name?: string | null; timezone?: string; now?: number; today?: TodayEvent[]; trips?: Trip[]; gmailEmail?: string | null }

const fmtTime = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(/^0/, '').toLowerCase()
const fmtDay = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
const senderOf = (e: AttentionEmail) => senderNameOf(e.from) || String(e.from || '').split('@')[0]
const subjectOf = (e: AttentionEmail) => String(e.subject || '').replace(/^(?:re|fwd?):\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 90)
const dateInText = (text: string) => text.match(/\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:,?\s+\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}|today|tomorrow)\b/i)?.[1]
const timeInText = (text: string) => text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i)?.[1]
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** The day a "5 Nov" / "Nov 5" / "05/11/2026" / "today" in an email means, as a UTC-midnight timestamp (year assumed the nearest one). Pure. */
export function dueDayOf(text: string, now: number): number | null {
  const d = dateInText(String(text || ''))
  if (!d) return null
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  if (/^today$/i.test(d)) return today
  if (/^tomorrow$/i.test(d)) return today + 86_400_000
  let day: number | undefined, month: number | undefined, year: number | undefined
  const dm = d.match(/^(\d{1,2})\s+([a-z]+)(?:,?\s+(\d{4}))?$/i), md = d.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i), num = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (dm) { day = Number(dm[1]); month = MONTHS.indexOf(dm[2].slice(0, 3).toLowerCase()); year = dm[3] ? Number(dm[3]) : undefined }
  else if (md) { day = Number(md[2]); month = MONTHS.indexOf(md[1].slice(0, 3).toLowerCase()); year = md[3] ? Number(md[3]) : undefined }
  else if (num) { day = Number(num[1]); month = Number(num[2]) - 1; year = Number(num[3].length === 2 ? `20${num[3]}` : num[3]) }
  if (day === undefined || month === undefined || month < 0 || day < 1 || day > 31) return null
  if (year === undefined) {
    // No year: the one that puts the date within half a year of now.
    const y = new Date(now).getUTCFullYear()
    const candidates = [y - 1, y, y + 1].map(yy => Date.UTC(yy, month!, day!))
    return candidates.reduce((best, c) => Math.abs(c - today) < Math.abs(best - today) ? c : best)
  }
  return Date.UTC(year, month, day)
}
const EXPLICIT_PAYMENT_DUE_DATE = new RegExp(
  '\\b(?:due(?:\\s+date)?\\s*(?:(?:on|by|is)\\s+|:\\s*)?|pay\\s+(?:on|by|before)\\s+|payment\\s+deadline\\s*(?:is|:)?\\s*|last\\s+date\\s*(?:is|:)?\\s*)((?:\\d{1,2}\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:,?\\s+\\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|today|tomorrow))\\b',
  'i',
)
/** A statement date does not establish that payment is already overdue. */
export function paymentDueDateInText(text: string): string | null {
  return String(text || '').match(EXPLICIT_PAYMENT_DUE_DATE)?.[1] || null
}
const OVERDUE_WINDOW = 45 * 86_400_000
/** "was due 5 Nov" when the day has passed (within 45 days), "due 5 Nov" otherwise. */
const dueWords = (text: string, now: number) => {
  const d = paymentDueDateInText(text), ts = d ? dueDayOf(d, now) : null
  if (!d || ts === null) return ''
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  return ts < today && today - ts <= OVERDUE_WINDOW ? `was due ${d}, so it's overdue unless you've paid` : `due ${d}`
}
/** True when the "ask" line only repeats the subject and amount (Amazon Pay, 6 Nov: "Payment Reminder · ₹15"). */
const restates = (ask: string, subject: string, amt: string | undefined) => {
  const pool = `${subject} ${amt || ''}`.toLowerCase()
  const words = ask.toLowerCase().split(/[^a-z0-9₹$.,]+/).filter(w => w.length > 2)
  return words.length === 0 || words.every(w => pool.includes(w))
}

const GATEWAY_SENDER = /\b(?:payment-?report|razorpay|payu|ccavenue|cashfree|paytm|phonepe|billdesk|instamojo|stripe|juspay|easebuzz|payments?@|noreply@pay)\b/i
/** "Your Order at CARPEDIEM STORE PRIVATE LIMITED is unsuccessful" → "Carpediem Store". Pure. */
export function merchantFromSubject(subject: string): string | null {
  const m = String(subject || '').match(/\b(?:order|payment|purchase|booking|subscription)\s+(?:at|to|with|from|for)\s+([A-Z][A-Za-z0-9&'.\- ]{2,60}?)(?=\s+(?:is|was|has|failed|unsuccessful|could|did|\(|-|–|—|:|,)|\s*$)/i)
    || String(subject || '').match(/^([A-Z][A-Za-z0-9&'.\- ]{2,40}?)\s*[:\-–—]\s*(?:payment|order|transaction)/i)
  if (!m) return null
  return m[1].replace(/\s+(?:private|pvt\.?|limited|ltd\.?|llp|inc\.?)\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}
/** What the alert was about, for the thread behind it (open-thread.ts). Pure. */
const decodeEntities = (t: string) => t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')

export function alertThreadData(kind: AlertKind, s: ScoredEmail, gmailEmail?: string | null) {
  const e = s.email, subject = String(e.subject || ''), text = `${subject} ${e.snippet || ''}`
  const amt = amountOf(text)
  const snippet = decodeEntities(String(e.snippet || '')).replace(/\s+/g, ' ').trim().slice(0, 300) || null
  return { subject, snippet, receivedAt: e.internalDate ? new Date(Number(e.internalDate)).toISOString() : null, sender: senderOf(e), senderEmail: (String(e.from || '').match(/<([^>]+)>/)?.[1] || (String(e.from || '').includes('@') ? String(e.from).trim() : null)) || null, merchant: merchantFromSubject(subject) || (GATEWAY_SENDER.test(String(e.from)) ? null : senderOf(e)), amount: amt?.text || null, threadId: e.threadId || null, emailId: e.id || null, alertKind: kind, gmailEmail: gmailEmail || null }
}

/** A line from the calendar or trips that changes what the person should do; nothing is guessed. Pure. */
export function contextLine(kind: AlertKind, s: ScoredEmail, ctx: AlertContext): string | null {
  const tz = ctx.timezone || 'Asia/Kolkata', now = ctx.now ?? Date.now()
  const trip = (ctx.trips || []).find(t => Date.parse(t.departAt) <= now + 14 * 86_400_000 && (!t.returnAt || Date.parse(t.returnAt) > now))
  if (trip && (kind === 'deadline' || kind === 'money_leaving')) {
    const away = Date.parse(trip.departAt) <= now
    if (away) return `You're travelling${trip.returnAt ? ` until ${fmtDay(trip.returnAt, tz)}` : ''}, so handle this from your phone or leave it for when you're back.`
    // Before a trip the flight matters only when the date in the email falls while you're away (6 Nov: a bill due 5 Nov got "you fly on 8 Nov").
    const dateText = `${s.email.subject} ${s.email.snippet}`
    const due = kind === 'money_leaving'
      ? dueDayOf(paymentDueDateInText(dateText) || '', now)
      : dueDayOf(dateText, now)
    const inTrip = due !== null && due >= Date.parse(trip.departAt) - 86_400_000 && (!trip.returnAt || due <= Date.parse(trip.returnAt))
    if (inTrip) return `You fly${trip.toCity ? ` to ${trip.toCity}` : ''} on ${fmtDay(trip.departAt, tz)} and this falls while you're away; best to settle it before then.`
  }
  if (kind === 'reply_waiting') {
    const meet = (ctx.today || []).find(ev => (ev.attendees || []).some(a => a.email.toLowerCase() === s.senderEmail) && Date.parse(ev.start) > now - 15 * 60_000)
    if (meet) return `You meet ${s.senderName.split(' ')[0] || 'them'} on the ${fmtTime(meet.start, tz)} call today, so you could answer there.`
  }
  if (kind === 'deadline') {
    const busy = (ctx.today || []).filter(ev => Date.parse(ev.start) > now).slice(0, 1)[0]
    if (busy) return `Your next meeting is ${busy.summary} at ${fmtTime(busy.start, tz)}; this takes a minute, so it's worth doing before.`
  }
  return null
}

const TAG: Record<AlertKind, string> = { payment_failed: '⚠️ Payment failed', money_leaving: '💳 Money leaving', deadline: '⏳ Deadline', security: '🔐 Security', reply_waiting: '✉️ Reply waiting', newsletter: '📰 Newsletter' }

/** One short message for one email. Says what the email states, what Gogo cannot tell, and the context line. Pure. */
export function composeAlert(kind: AlertKind, s: ScoredEmail, ctx: AlertContext = {}): string {
  const e = s.email, text = `${e.subject} ${e.snippet}`.replace(/\s+/g, ' ')
  const who = senderOf(e), subject = subjectOf(e), amt = s.category === 'bill_due' ? billAmountOf(text) : amountOf(text), day = dateInText(text), time = timeInText(text)
  const name = ctx.name ? `${ctx.name.split(' ')[0]}, ` : ''
  let body = ''
  if (kind === 'payment_failed') {
    // 7 Nov live: "Payment-report says a payment of ₹3398.00 failed" — the gateway's name, not the shop's. Name the shop.
    const shop = merchantFromSubject(subject)
    const viaGateway = GATEWAY_SENDER.test(`${e.from} ${who}`)
    if (shop && viaGateway) body = `${name}your${amt ? ` *${amt.text}*` : ''} payment to *${shop}* failed${/\b(?:failed\s+again|again\s+failed|second\s+(?:attempt|time)|twice|repeated(?:ly)?)\b/i.test(text) ? ' again' : ''} (${who} handles their payments). "${subject}".`
    else body = `${name}${who} says a payment${amt ? ` of *${amt.text}*` : ''} failed${/\b(?:failed\s+again|again\s+failed|second\s+(?:attempt|time)|twice|repeated(?:ly)?)\b/i.test(text) ? ' again' : ''}${/insufficient/i.test(text) ? ' for insufficient funds' : ''}. "${subject}".`
    body += /\b(?:suspend|pause|interrupt|shutdown|shut down|disconnect|cancel)/i.test(text) ? ' The email says the service may be paused, so update the payment method first.' : " The email doesn't say whether it was paid another way, so check before paying again."
  } else if (kind === 'money_leaving') {
    if (CONFIRM_CHARGE.test(text)) body = `${name}${who} is asking you to confirm a${amt ? ` *${amt.text}*` : ''} payment. "${subject}". If you don't recognise it, don't confirm; contact them through their own app or site.`
    else if (MANDATE.test(text)) body = `${name}${who} reports a new recurring-payment mandate${amt ? ` with a *${amt.text}* maximum` : ''}. "${subject}". If you didn't set this up, cancel it from your bank's app.`
    else if (RENEW.test(text)) body = `${name}your ${subject.replace(/\byour\b/gi, '').trim()} renews${day ? ` on ${day}` : ' soon'}${amt ? ` for *${amt.text}*` : ''}, from ${who}. Say "remind me to decide on this" with a date if you want a nudge first.`
    else {
      const due = dueWords(text, ctx.now ?? Date.now()) || (dateInText(text) ? '' : s.due || '')
      const ask = s.ask && !restates(s.ask, subject, amt?.text) ? ` ${s.ask}` : ''
      body = `${name}${who}: ${amt ? `*${amt.text}* ` : ''}${due ? `${due}, ` : ''}"${subject}".${ask}`
    }
  } else if (kind === 'deadline') {
    body = `${name}${who} sent "${subject}".${day || time ? ` It ${/expir/i.test(text) ? 'expires' : 'is due'} ${day ? `${day}${time ? ` at ${time}` : ''}` : `at ${time}`}.` : ' It has a deadline.'} I can't tell whether you've already done it.`
  } else if (kind === 'security') {
    // Google's live wording (6 Nov): "You allowed Instinct access to some of your Google Account data".
    const app = text.match(/\b([A-Z][\w.]+(?:\s+[A-Z][\w.]+)?)\s+(?:was\s+)?(?:granted|given)\s+access\b/)?.[1]
      || text.match(/\b(?:you\s+allowed|allowed|gave)\s+([A-Z][\w.]+(?:\s+[A-Z][\w.]+)?)\s+access\b/)?.[1]
    body = `${name}${who} says ${app ? `*${app}* was granted access to your account` : subject.toLowerCase()}${day || time ? ` (${[day, time].filter(Boolean).join(' ')})` : ''}. If that was you, nothing to do. If not, check your account's connected apps and sign-ins. The email doesn't say what data was shared.`
  } else if (kind === 'reply_waiting') {
    const ask = s.ask && !restates(s.ask, subject, undefined) ? ` ${s.ask}` : ''
    body = `${name}${who} is waiting on you: "${subject}".${ask}${s.due ? ` (${s.due})` : ''} Say "draft a reply" and I'll show it before anything is sent.`
  } else {
    body = `${name}${who}: "${subject}".`
  }
  const extra = contextLine(kind, s, ctx)
  // No Gmail link: WhatsApp turns the first URL into a preview card above the message (6 Nov), which buried the alert.
  return [`${TAG[kind]}`, body.replace(/\s{2,}/g, ' ').trim(), extra].filter(Boolean).join('\n')
}

// ── selection ──────────────────────────────────────────────────────────────────
export type AlertState = { alerted: string[]; day: string; sentToday: number }
export type MailAlert = { id: string; kind: AlertKind; message: string; topic: 'bills' | 'replies' | 'watches'; email: AttentionEmail; scored: ScoredEmail }
const TOPIC: Record<AlertKind, MailAlert['topic']> = { payment_failed: 'bills', money_leaving: 'bills', deadline: 'watches', security: 'watches', reply_waiting: 'replies', newsletter: 'watches' }

export const dayKey = (now: number, tz: string) => new Date(now).toLocaleDateString('en-CA', { timeZone: tz })
export function inQuietHours(now: number, tz: string, r: MailAlertRules) {
  const h = Number(new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).slice(0, 2))
  return r.quietStart > r.quietEnd ? h >= r.quietStart || h < r.quietEnd : h >= r.quietStart && h < r.quietEnd
}

/** The alerts to send now: new, wanted, outside quiet hours, within the daily cap. The rest wait. Pure. */
export function selectAlerts(emails: AttentionEmail[], opts: { rules: MailAlertRules; attention?: AttentionRule[]; state: AlertState | null; ctx: AlertContext; ownEmail?: string | null; repliedSenders?: Set<string> }) {
  const tz = opts.ctx.timezone || 'Asia/Kolkata', now = opts.ctx.now ?? Date.now()
  const today = dayKey(now, tz)
  const prior = opts.state && opts.state.day === today ? opts.state.sentToday : 0
  const alerted = new Set(opts.state?.alerted || [])
  const quiet = inQuietHours(now, tz, opts.rules)
  const out: MailAlert[] = []
  const deferred: string[] = []
  for (const e of emails) {
    const id = String(e.messageId || e.id || '')
    if (!id || alerted.has(id)) continue
    const s = scoreEmail(e, { rules: opts.attention || [], ownEmail: opts.ownEmail || null, repliedSenders: opts.repliedSenders, now })
    const kind = alertKindOf(s)
    if (!kind || !opts.rules.kinds[kind]) continue
    if (quiet || prior + out.length >= opts.rules.maxPerDay) { deferred.push(id); continue }
    out.push({ id, kind, message: composeAlert(kind, s, opts.ctx), topic: TOPIC[kind], email: e, scored: s })
  }
  const nextState: AlertState = { alerted: [...out.map(a => a.id), ...(opts.state?.alerted || [])].slice(0, 400), day: today, sentToday: prior + out.length }
  return { alerts: out, deferred, state: nextState, quiet }
}

/** Raw inbox messages (listRecentWorkspaceInbox) → AttentionEmail. Pure. */
export function toAttentionEmail(m: any): AttentionEmail | null {
  const id = String(m?.id || '')
  if (!id) return null
  return {
    id, threadId: m.threadId ? String(m.threadId) : null, messageId: m.messageId ? String(m.messageId) : id,
    from: String(m.from || ''), to: m.to ? String(m.to) : null, subject: String(m.subject || '(No subject)'), snippet: String(m.snippet || ''),
    internalDate: Number(m.internalDate) || (Date.parse(String(m.date || '')) || null), date: m.date ? String(m.date) : null,
    labelIds: Array.isArray(m.labelIds) ? m.labelIds.map(String) : [], isUnread: m.isUnread === true || (Array.isArray(m.labelIds) && m.labelIds.includes('UNREAD')),
    listId: m.listId ? String(m.listId) : null, listUnsubscribe: m.listUnsubscribe ? String(m.listUnsubscribe) : null, source: 'gmail',
  }
}
export { classifyEmail, scoreEmail }
