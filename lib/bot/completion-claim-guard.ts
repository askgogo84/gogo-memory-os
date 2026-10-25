// Hard guard on model-written replies: a chat model can only talk, so it may never report a
// consequential action (booked, reserved, ordered, paid, sent, scheduled, added to calendar,
// cancelled) as done unless the owner's own records show it was done.
//
// 19 Oct live (WhatsApp, 23:29 IST): "1" after an approval list reached general chat, which replied
// "Booking confirmed for 2 at Toit Indiranagar tomorrow (20 Oct) at 7pm under Goverdhan. Check your
// email/SMS for the confirmation." Nothing had been booked: the approval was still pending and no
// worker had run. action-claim-guard.ts reads the shape of first-person receipts; this one reads
// completion claims of any shape and checks them against verified completion records.
//
// Pure detection + matching; loadCompletionEvidence is the only DB read and runs only when a claim
// was detected, so ordinary replies cost nothing.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isApprovalExpired } from '@/lib/agent/approval-ttl'

export type ClaimKind = 'booking' | 'order' | 'payment' | 'message' | 'calendar' | 'cancel' | 'schedule'

export type CompletionRecord = {
  kind: ClaimKind
  /** Names that identify what was done: restaurant, event title, venue, recipient. */
  label: string
  /** When the completion was recorded (ISO). Unnamed claims need a recent one. */
  at?: string | null
}

export type PendingApprovalHint = { title: string; subject: string; actionType?: string | null }

type Claim = { sentence: string; kind: ClaimKind }

const B = String.raw
const SUBJECT = B`(?:i(?:'ve|’ve|\s+have)?|gogo(?:\s+has)?|we(?:'ve|’ve|\s+have)?)\s+(?:just\s+|now\s+|successfully\s+|already\s+|also\s+)?`
const CLAIMS: Array<{ kind: ClaimKind; re: RegExp }> = [
  // "Booking confirmed", "Your table is booked", "Reservation has been made", "Tickets secured"
  { kind: 'booking', re: new RegExp(B`\b(?:booking|reservation|table|seats?|tickets?|slot)s?\s+(?:is\s+|are\s+|was\s+|were\s+|has\s+been\s+|have\s+been\s+|now\s+|all\s+)*(?:confirmed|booked|reserved|secured|done|made|locked\s+in|successful)\b`, 'i') },
  { kind: 'booking', re: /\b(?:booking|reservation|table|seats?|tickets?|slot)s?\b[^.!?\n]{0,60}?\b(?:is|are|was|were|has\s+been|have\s+been)\s+(?:now\s+|all\s+|successfully\s+)?(?:confirmed|booked|reserved|secured)\b/i },
  { kind: 'booking', re: new RegExp(SUBJECT + B`(?:booked|reserved|confirmed|secured|locked\s+in)\b`, 'i') },
  { kind: 'booking', re: /^[\s\W]*(?:booked|reserved|confirmed|all\s+set)\b(?!\s+(?:by|on\s+your|through|via)\b)/i },
  { kind: 'booking', re: /\b(?:confirmed|booked|reserved)\s+for\s+\d+\b/i },
  { kind: 'booking', re: /\byou(?:'re|’re|\s+are)\s+(?:all\s+)?(?:booked|confirmed|reserved)\b/i },
  // The tell of an invented booking: pointing at a confirmation that would only exist if it happened.
  { kind: 'booking', re: /\b(?:check|look\s+out\s+for|watch)\s+(?:your\s+)?(?:e-?mail|sms|inbox|messages|phone)(?:\s*(?:\/|or|and)\s*(?:e-?mail|sms|inbox|messages|phone))*\s+for\s+(?:the\s+|a\s+|your\s+)?confirmation\b/i },
  { kind: 'order', re: new RegExp(B`\border\s+(?:is\s+|was\s+|has\s+been\s+)?(?:placed|confirmed|done)\b|` + SUBJECT + B`(?:ordered|placed\s+(?:the|your|an?)\s+order|purchased|bought)\b`, 'i') },
  { kind: 'payment', re: new RegExp(B`\bpayment\s+(?:is\s+|was\s+|has\s+been\s+)?(?:done|made|complete(?:d)?|successful|sent)\b|` + SUBJECT + B`paid\b`, 'i') },
  { kind: 'message', re: new RegExp(SUBJECT + B`(?:sent|emailed|messaged|texted|forwarded)\b|\b(?:message|whatsapp|sms|text|invite|invitation)\s+(?:has\s+been\s+|was\s+|is\s+)?sent\b`, 'i') },
  { kind: 'calendar', re: new RegExp(B`\b(?:added|blocked|put|saved)\s+(?:it\s+|this\s+|that\s+|the\s+\w+\s+)?(?:to|on|in)\s+(?:your\s+)?calendar\b|` + SUBJECT + B`(?:blocked|added|created)\b[^.!?\n]{0,40}\bcalendar\b|\bcalendar\s+(?:is\s+|has\s+been\s+)?(?:blocked|updated)\b`, 'i') },
  { kind: 'cancel', re: new RegExp(SUBJECT + B`cancell?ed\b|\b(?:booking|reservation|order|table|subscription)\s+(?:is\s+|was\s+|has\s+been\s+)?cancell?ed\b`, 'i') },
  { kind: 'schedule', re: new RegExp(SUBJECT + B`(?:scheduled|rescheduled)\b`, 'i') },
]

// Questions, offers, plans, negations, conditions and second-hand reports are not completion claims.
const NOT_A_CLAIM = new RegExp([
  B`\?\s*$`,
  B`\b(?:want\s+me\s+to|shall\s+i|should\s+i|do\s+you\s+want|would\s+you\s+like|can\s+i|could\s+i|let\s+me\s+know)\b`,
  B`\b(?:i'll|i’ll|i\s+will|i\s+can|i'd|i’d|going\s+to|will\s+be|would\s+be|once|after\s+it|until|unless|if)\b`,
  B`\b(?:not|haven't|haven’t|hasn't|hasn’t|isn't|isn’t|wasn't|wasn’t|never|nothing|no\s+booking|yet|waiting|pending)\b`,
  B`\b(?:according\s+to|from\s+your\s+(?:e-?mail|inbox|mail|sms|messages|ticket)|in\s+your\s+(?:e-?mail|inbox|mail)|your\s+(?:e-?mail|ticket|confirmation(?:\s+e-?mail)?)\s+(?:says|shows))\b`,
  B`\b(?:yesterday|last\s+(?:night|week|month)|earlier|ago|previously)\b`,
].join('|'), 'i')

export function splitSentences(reply: string): string[] {
  return String(reply || '').split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
}

/** Every sentence of the reply that reports a consequential action as done. Pure. */
export function detectCompletionClaims(reply: string): Claim[] {
  const out: Claim[] = []
  for (const sentence of splitSentences(reply)) {
    if (NOT_A_CLAIM.test(sentence)) continue
    const hit = CLAIMS.find(({ re }) => re.test(sentence))
    if (hit) out.push({ sentence, kind: hit.kind })
  }
  return out
}

const STOP = new Set(['booking', 'bookings', 'reservation', 'reservations', 'table', 'tables', 'ticket', 'tickets', 'event', 'events', 'movie', 'show', 'mall', 'restaurant', 'hotel', 'flight', 'cinema', 'reserve', 'your', 'with', 'from', 'today', 'tomorrow', 'tonight', 'under', 'people', 'guests', 'confirmed', 'attempt', 'timed', 'approve', 'calendar', 'block', 'this', 'that', 'there', 'their', 'india', 'bengaluru', 'bangalore', 'road', 'main', 'email', 'message'])
export function significantTokens(value: string): string[] {
  return [...new Set(String(value || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter((t) => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t)))]
}

const KIND_RECORDS: Record<ClaimKind, ClaimKind[]> = {
  booking: ['booking'], order: ['order', 'payment'], payment: ['payment', 'order'], message: ['message'],
  calendar: ['calendar'], cancel: ['cancel'], schedule: ['schedule', 'calendar'],
}
const RECENT_UNNAMED_MS = 30 * 60_000

/**
 * A claim is supported when a record of the same kind names something the sentence names, or, for a
 * sentence that names nothing ("Booked!"), when a record of that kind was completed in the last 30
 * minutes. Pure.
 */
export function claimSupported(claim: Claim, records: CompletionRecord[], now: number = Date.now()): boolean {
  const kinds = KIND_RECORDS[claim.kind]
  const sameKind = records.filter((r) => kinds.includes(r.kind))
  if (!sameKind.length) return false
  const sentence = ` ${claim.sentence.toLowerCase().normalize('NFKD')} `
  if (sameKind.some((r) => significantTokens(r.label).some((t) => sentence.includes(t)))) return true
  // A sentence that names something (a capitalised word after the first) must match a record by name.
  if (/\s[A-Z][a-z]{2,}/.test(claim.sentence)) return false
  return sameKind.some((r) => { const at = Date.parse(String(r.at || '')); return Number.isFinite(at) && now - at <= RECENT_UNNAMED_MS && now >= at - 60_000 })
}

const NOTHING_DONE: Record<ClaimKind, string> = {
  booking: 'Nothing has been booked yet.',
  order: 'Nothing has been ordered yet.',
  payment: 'Nothing has been paid.',
  message: 'Nothing has been sent.',
  calendar: 'Nothing has been added to your calendar.',
  cancel: 'Nothing has been cancelled.',
  schedule: 'Nothing has been scheduled.',
}

/** The honest replacement line. Names the pending approval when the claim is about one. Pure. */
export function honestCompletionReply(claim: Claim, pending: PendingApprovalHint[]): string {
  const verb = claim.kind === 'booking' ? 'booked' : claim.kind === 'order' ? 'ordered' : claim.kind === 'payment' ? 'paid for' : claim.kind === 'message' ? 'sent' : claim.kind === 'cancel' ? 'cancelled' : claim.kind === 'calendar' ? 'added to your calendar' : 'scheduled'
  const sentence = claim.sentence.toLowerCase()
  const named = pending.filter((p) => significantTokens(p.subject).some((t) => sentence.includes(t)))
  const bookingish = pending.filter((p) => p.actionType === 'booking')
  const match = named.length === 1 ? named[0] : claim.kind === 'booking' && bookingish.length === 1 ? bookingish[0] : null
  if (match) {
    const what = claim.kind === 'booking' || match.actionType === 'booking' ? `the ${match.subject} reservation` : `"${match.title}"`
    return `I haven't ${verb} anything — ${what} is still waiting for your approval. Reply approve to go ahead, or reject to stop.`
  }
  return NOTHING_DONE[claim.kind]
}

export type CompletionGuardResult = { text: string; blocked: boolean; claim?: Claim }

/** Pure core: decide against the given records and pending approvals. */
export function guardCompletionClaimsWith(reply: string, records: CompletionRecord[], pending: PendingApprovalHint[], now: number = Date.now()): CompletionGuardResult {
  const claims = detectCompletionClaims(reply)
  const unsupported = claims.find((c) => !claimSupported(c, records, now))
  if (!unsupported) return { text: reply, blocked: false }
  return { text: honestCompletionReply(unsupported, pending), blocked: true, claim: unsupported }
}

const BOOKING_LIFE_EVENT_TYPES = new Set(['travel', 'event', 'appointment', 'purchase', 'delivery'])
const CALENDAR_PLANS = new Set(['calendar_update', 'booking_event_calendar', 'memory_ticket_to_calendar'])

/**
 * Verified completion records for one owner. Strict allowlist: a pending approval, a research run
 * or a slot-question step is never evidence. Reservations count only with the provider
 * confirmation recorded; saved bookings (tickets/emails captured as life events) count as bookings
 * the owner made; Gmail sends and calendar writes count only as completed executor runs.
 */
export async function loadCompletionEvidence(telegramId: number | string, now: Date = new Date()): Promise<{ records: CompletionRecord[]; pending: PendingApprovalHint[] }> {
  const owner = String(telegramId)
  const since = new Date(now.getTime() - 60 * 86400_000).toISOString()
  const [runs, events, approvals] = await Promise.all([
    supabaseAdmin.from('agent_runs').select('title,status,metadata_json,completed_at,updated_at').eq('telegram_id', owner).eq('status', 'completed').gte('updated_at', since).order('updated_at', { ascending: false }).limit(60),
    supabaseAdmin.from('life_events').select('event_type,title,provider,location,lifecycle_state,metadata_json,updated_at').eq('telegram_id', owner).gte('updated_at', since).order('updated_at', { ascending: false }).limit(80),
    supabaseAdmin.from('agent_approvals').select('title,action_type,status,requested_at,execution_payload').eq('telegram_id', owner).eq('status', 'pending').order('requested_at', { ascending: false }).limit(10),
  ])
  const records: CompletionRecord[] = []
  for (const run of ((runs as any)?.data || []) as any[]) {
    const meta = run?.metadata_json || {}
    const plan = String(meta.plan_type || '')
    const at = run.completed_at || run.updated_at || null
    const label = [run.title, meta.restaurant, meta.recipient, meta.to, meta.subject, meta.event_title].filter(Boolean).join(' ')
    if (meta.providerConfirmationVerified === true) records.push({ kind: 'booking', label, at })
    else if (plan === 'gmail_send') records.push({ kind: 'message', label, at })
    else if (CALENDAR_PLANS.has(plan)) records.push({ kind: 'calendar', label, at })
  }
  for (const ev of ((events as any)?.data || []) as any[]) {
    const type = String(ev?.event_type || '')
    const meta = ev?.metadata_json || {}
    const label = [ev.title, ev.provider, ev.location].filter(Boolean).join(' ')
    if (ev.lifecycle_state === 'cancelled') { records.push({ kind: 'cancel', label, at: ev.updated_at }); continue }
    if (type === 'reservation' ? meta.reservationConfirmed === true : BOOKING_LIFE_EVENT_TYPES.has(type)) records.push({ kind: 'booking', label, at: ev.updated_at })
    if (type === 'purchase' || type === 'delivery') records.push({ kind: 'order', label, at: ev.updated_at })
    if (meta?.calendar?.eventId) records.push({ kind: 'calendar', label, at: meta.calendar.createdAt || ev.updated_at })
  }
  const pending: PendingApprovalHint[] = (((approvals as any)?.data || []) as any[])
    .filter((row) => !isApprovalExpired(row, now))
    .map((row) => {
      const title = String(row.title || 'Pending action')
      return { title, subject: (title.split('·').pop() || title).trim(), actionType: row.action_type || null }
    })
  return { records, pending }
}

/** Checks a model-written reply; reads the owner's records only when the reply claims a completion. */
export async function guardCompletionClaims(reply: string, telegramId: number | string, now: Date = new Date()): Promise<CompletionGuardResult> {
  if (!detectCompletionClaims(reply).length) return { text: reply, blocked: false }
  let evidence: { records: CompletionRecord[]; pending: PendingApprovalHint[] }
  try {
    evidence = await loadCompletionEvidence(telegramId, now)
  } catch (err: any) {
    // Unreadable records cannot support a claim: fail closed.
    console.error('COMPLETION_EVIDENCE_READ_FAILED:', err?.message || err)
    evidence = { records: [], pending: [] }
  }
  return guardCompletionClaimsWith(reply, evidence.records, evidence.pending, now.getTime())
}
