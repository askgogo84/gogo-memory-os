import type { AgentActor } from '@/lib/agent/actor'
import type { AgentSurface } from '@/lib/agent/orchestrator'
import { isContentlessReminderRequest } from './reminder-command'
import { looksLikeNewCommand } from './pending-followup'
import { isAmPmChoice } from './handlers/reminder-ampm-followup'
import { getPendingFriend, isFriendReminderFollowupCandidate } from './handlers/friend-reminders'
import {
  getLatestFollowupState,
  saveFollowupState,
  clearFollowupState,
  isFreshFollowupState,
  isStrictlyFreshFollowupState,
} from './handlers/followup-state'
import { closePendingQuestion, listOpenPendingQuestions, type PendingDetail, type PendingQuestion } from './pending-questions'

/**
 * Binds a short reply to the question Gogo just asked (PR 1 of the understand-first router).
 *
 * "This Saturday 8pm" right after "What time should I book Toit for?" is the answer to that
 * question, not a new reminder. The resolver:
 *   1. reads the reply as a DETAIL answer (bare date/time, party size, or a restaurant name when a
 *      restaurant was literally asked for) — anything else returns null and routing continues;
 *   2. collects the fresh open questions that expect that kind of detail (registry questions plus
 *      the legacy pending_reminder / pending_calendar / reminder_ampm / friend-time follow-ups);
 *   3. exactly one registry candidate → close it and hand the answer to that kind's RESUMER;
 *      two or more candidates → ask which one (never guess); only legacy candidates → null, so the
 *      legacy follow-up blocks keep resolving them exactly as before; none → null.
 *
 * It never resolves approvals and never grants authority: a resumer re-enters the same flow the
 * original request used, so every approval, policy and provider gate runs again unchanged.
 */

export type DetailAnswer = {
  raw: string
  details: Set<PendingDetail>
  /** The date/time part of the reply, party phrase removed. */
  when: string
  party: number | null
  /** A bare integer ("4") — party size only when party is the detail that was asked. */
  bareNumber: number | null
  /** A short free-text name — only binds when a restaurant was the detail asked. */
  name: string
}

export type PendingQuestionSurface = AgentSurface | 'telegram'

export type ResolverResult = {
  text: string
  handledBy: string
  status?: string
  runId?: string
  capability?: string
  questionId?: string
}

export type ResumerArgs = {
  actor: AgentActor
  surface: PendingQuestionSurface
  question: PendingQuestion
  answer: DetailAnswer
  messageId?: string | number | null
}

export type PendingQuestionResumer = (args: ResumerArgs) => Promise<ResolverResult | null>

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }
const N = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
const PARTY_PATTERNS = [
  new RegExp(`\\b(?:a\\s+)?(?:party|group)\\s+of\\s+${N}\\b`, 'i'),
  new RegExp(`\\b(?:a\\s+)?(?:table\\s+)?for\\s+${N}(?:\\s+(?:people|persons?|guests?|pax|adults|of\\s+us))?\\b`, 'i'),
  new RegExp(`\\b(?:we\\s+are|we['’]re)\\s+${N}\\b`, 'i'),
  new RegExp(`\\b${N}\\s+(?:people|persons?|guests?|pax|adults|of\\s+us)\\b`, 'i'),
]
const TIME_RE = /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\bat\s+\d{1,2}\b|\b(?:noon|midnight)\b/i
const DATE_RE = /\b(?:(?:this|next|coming)\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:today|tonight|tomorrow|tmrw|tmr|weekend)\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b|\b20\d{2}-\d{1,2}-\d{1,2}\b/i
const CHIT_CHAT = /^(?:ok(?:ay)?|k|yes|yeah|yep|yup|no|nope|nah|thanks?|thank\s+you|thx|ty|cool|great|nice|sure|fine|hmm+|hi|hello|hey|cancel|stop|never\s*mind|nevermind|forget\s+it|later|done|approve[ds]?|reject(?:ed)?|confirm(?:ed)?|wait|what|why|how|who|when|where|which|lol|haha+|good|perfect|awesome|got\s+it|go\s+ahead|continue|resume|status|help|menu)\b/i

function toNumber(raw: string): number | null {
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw.toLowerCase()]
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null
}

/** Reads a reply as a detail answer, or null when it is anything more than a detail. */
export function classifyDetailAnswer(text: string): DetailAnswer | null {
  const raw = String(text || '').trim().replace(/[.!]+$/, '').trim()
  if (!raw || raw.length > 80 || /[\n?]/.test(raw)) return null
  const empty = { raw, details: new Set<PendingDetail>(), when: '', party: null, bareNumber: null, name: '' }
  const bare = raw.match(/^#?(\d{1,2})$/)
  if (bare) {
    const n = toNumber(bare[1])
    return n ? { ...empty, bareNumber: n } : null
  }
  let rest = raw
  let party: number | null = null
  for (const re of PARTY_PATTERNS) {
    const m = rest.match(re)
    if (m) {
      party = toNumber(m[1])
      if (party) rest = (rest.slice(0, m.index) + ' ' + rest.slice((m.index || 0) + m[0].length)).replace(/\s+/g, ' ').trim()
      break
    }
  }
  const restClean = rest.replace(/^[,;\s]+|[,;\s]+$/g, '').trim()
  const details = new Set<PendingDetail>()
  if (party) details.add('party')
  if (restClean) {
    if (isContentlessReminderRequest(restClean)) {
      if (TIME_RE.test(restClean)) details.add('time')
      if (DATE_RE.test(restClean)) details.add('date')
      // Leftover filler with no date or time ("please") is not a detail on its own.
      if (!details.has('time') && !details.has('date') && !party) return null
    } else if (!party) {
      // Free text: only a short name-shaped reply can be a restaurant answer.
      const name = restClean.replace(/^(?:at|in|it'?s|its|try)\s+/i, '').trim()
      const words = name.split(/\s+/).filter(Boolean)
      if (!name || name.length > 60 || words.length > 6 || !/\p{L}/u.test(name) || CHIT_CHAT.test(name)) return null
      if (TIME_RE.test(name) || DATE_RE.test(name) || looksLikeNewCommand(name)) return null
      return { ...empty, name }
    } else {
      // "for 4 at Toit" mixes a party with free text; let routing read the whole sentence.
      return null
    }
  }
  if (!details.size) return null
  return { raw, details, when: (details.has('date') || details.has('time')) ? restClean : '', party, bareNumber: null, name: '' }
}

function questionAccepts(q: PendingQuestion, a: DetailAnswer): boolean {
  if (a.bareNumber !== null) return q.expects[0] === 'party'
  if (a.name) return q.expects[0] === 'restaurant' && !q.exactOnly
  for (const d of a.details) if (q.expects.includes(d)) return true
  return false
}

// ── Resumers ────────────────────────────────────────────────────────────────────

const CLOCK_STRIP = [
  /\bbetween\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\s+(?:and|to|-)\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?/gi,
  /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\s*(?:-|to)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b/gi,
  /\b(?:at|around|by|after|before|only\s+at)\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?(?:\s+only)?\b/gi,
  /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b(?:\s+only)?/gi,
  /\b\d{1,2}:\d{2}\b/g,
]
const DATE_STRIP = [
  /\b(?:on\s+)?(?:(?:this|next|coming)\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/gi,
  /\b(?:day\s+after\s+tomorrow|tomorrow|tmrw|tmr|today|tonight)\b/gi,
  /\b(?:on\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:[ ,]+20\d{2})?\b/gi,
  /\b20\d{2}-\d{1,2}-\d{1,2}\b/g,
]
const PARTY_STRIP = [/\b(?:a\s+)?party\s+of\s+\d{1,2}\b/gi, /\bfor\s+\d{1,2}(?:\s+(?:people|persons?|guests?|pax|adults))?\b/gi]

function tidy(text: string) {
  return text.replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').replace(/([,.;])\s*[,.;]+/g, '$1').trim()
    .replace(/(?:[,;]\s*|\s+(?:on|at|for|by|around|or|and))+$/i, '').replace(/[,.;!?]+$/, '').trim()
}

/** The answer's date/time with "at" before its clock, so the reservation parser reads it as the dining time. */
function canonicalWhen(when: string) {
  if (!when) return ''
  if (/\bbetween\b|\d\s*(?:-|to)\s*\d/i.test(when)) return when
  return when.replace(/(^|\s)(?!at\s)((?:\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm))|(?:\d{1,2}:\d{2}))/i, (m, lead, clock, offset, all) => {
    const before = String(all).slice(0, offset + String(lead).length)
    return /\bat\s*$/i.test(before) ? m : `${lead}at ${clock}`
  })
}

/** Merge a detail answer into the original reservation request; the answer overrides what it restates. */
export function mergeReservationAnswer(originalText: string, answer: DetailAnswer, asked: PendingDetail | undefined, parse?: (text: string) => { restaurant?: string } | null): string {
  let base = String(originalText || '')
  const party = answer.party ?? (answer.bareNumber !== null && asked === 'party' ? answer.bareNumber : null)
  if (answer.details.has('time')) for (const re of CLOCK_STRIP) base = base.replace(re, ' ')
  if (answer.details.has('date')) for (const re of DATE_STRIP) base = base.replace(re, ' ')
  if (party) for (const re of PARTY_STRIP) base = base.replace(re, ' ')
  base = tidy(base)
  if (answer.name) {
    const name = answer.name.replace(/[^\p{L}\p{N}&'’ .-]/gu, ' ').replace(/\s+/g, ' ').trim()
    const inserted = /\b(?:table|reservation|booking)\b/i.test(base) ? base.replace(/\b(table|reservation|booking)\b/i, `$1 at ${name}`) : ''
    if (inserted && (!parse || parse(inserted)?.restaurant)) return inserted
    return `${base} at ${name}`
  }
  const parts = [party ? `for ${party} people` : '', canonicalWhen(answer.when)].filter(Boolean)
  return parts.length ? `${base}. ${parts.join(' ')}` : base
}

async function resumeReservationSlot({ actor, surface, question, answer, messageId }: ResumerArgs): Promise<ResolverResult | null> {
  const originalText = String(question.context?.originalText || '').trim()
  if (!originalText) return null
  const rr = await import('@/lib/agent/restaurant-reservation')
  const merged = mergeReservationAnswer(originalText, answer, question.expects[0], rr.parseRestaurantReservationIntent)
  const result = surface === 'whatsapp'
    ? await rr.queueRestaurantReservationResearch({ actor, text: merged, messageId: messageId ?? null })
    : await rr.tryRunRestaurantReservation({ actor, surface: surface === 'telegram' ? 'web' : surface, text: merged })
  if (!result) return null
  return {
    text: String(result.text || ''),
    handledBy: String((result as any).handledBy || 'restaurant-reservation'),
    status: (result as any).status ? String((result as any).status) : undefined,
    runId: (result as any).runId ? String((result as any).runId) : undefined,
    capability: 'browser',
    questionId: question.id,
  }
}

/** One resumer per question kind. A kind without a resumer is never bound. */
export const RESUMERS: Record<string, PendingQuestionResumer> = {
  reservation_slot: resumeReservationSlot,
}

// ── Legacy follow-ups that also wait for a date/time ───────────────────────────

type Candidate = { source: 'registry'; question: PendingQuestion; label: string } | { source: 'legacy'; kind: string; label: string }

function questionLabel(q: PendingQuestion): string {
  const label = String(q.context?.label || '').trim()
  if (label) return label
  return `${q.capability || q.kind} (${q.expects[0] || 'detail'})`
}

async function legacyCandidates(telegramId: number, text: string, answer: DetailAnswer): Promise<Candidate[]> {
  if (!answer.details.has('date') && !answer.details.has('time')) return []
  const out: Candidate[] = []
  try {
    if (!looksLikeNewCommand(text)) {
      const r = await getLatestFollowupState(telegramId, 'pending_reminder')
      if (r && isFreshFollowupState(r)) out.push({ source: 'legacy', kind: 'pending_reminder', label: r.payload?.task ? `Reminder: ${String(r.payload.task).slice(0, 60)}` : 'Reminder (time)' })
      const c = await getLatestFollowupState(telegramId, 'pending_calendar')
      if (c && isFreshFollowupState(c)) out.push({ source: 'legacy', kind: 'pending_calendar', label: `Calendar event: ${String(c.payload?.title || 'meeting').slice(0, 60)}` })
    }
    if (isAmPmChoice(text)) {
      const a = await getLatestFollowupState(telegramId, 'reminder_ampm')
      if (a?.payload?.originalText && isFreshFollowupState(a)) out.push({ source: 'legacy', kind: 'reminder_ampm', label: 'Reminder (am or pm)' })
    }
    if (isFriendReminderFollowupCandidate(text)) {
      const f = await getPendingFriend(telegramId)
      if (f && f.stage === 'time') out.push({ source: 'legacy', kind: 'friend_time', label: `Reminder for ${f.name}` })
    }
  } catch (err: any) {
    console.error('PENDING_QUESTION_LEGACY_READ_FAILED:', err?.message || err)
  }
  return out
}

// ── Disambiguation ("which one?") ──────────────────────────────────────────────

const CHOICE_STATE = 'pending_question_choice'
const CHOICE_RE = /^\s*(?:#|no\.?\s*|option\s+)?([1-9])\s*[.)]?\s*$|^\s*(?:the\s+)?(first|second|third|fourth)(?:\s+one)?\s*[.!]?\s*$/i
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 }

async function askWhich(telegramId: number, answer: DetailAnswer, candidates: Candidate[]): Promise<ResolverResult> {
  const shown = candidates.slice(0, 4)
  await saveFollowupState(telegramId, CHOICE_STATE, {
    telegramId,
    answer: answer.raw,
    candidates: shown.map((c) => (c.source === 'registry' ? { source: 'registry', id: c.question.id, label: c.label } : { source: 'legacy', kind: c.kind, label: c.label })),
    created_at: new Date().toISOString(),
  })
  const lines = shown.map((c, i) => `${i + 1}. ${c.label}`).join('\n')
  return {
    text: `I have more than one open question, so I won't guess. Which one is “${answer.raw}” for?\n${lines}\n\nReply with the number. Nothing has been booked or set yet.`,
    handledBy: 'pending-question-ambiguous',
    status: 'paused',
  }
}

async function tryResolveChoice(params: { actor: AgentActor; surface: PendingQuestionSurface; text: string; messageId?: string | number | null }): Promise<ResolverResult | null> {
  const m = params.text.match(CHOICE_RE)
  if (!m) return null
  const telegramId = params.actor.legacyTelegramId
  const state = await getLatestFollowupState(telegramId, CHOICE_STATE)
  if (!state || !isStrictlyFreshFollowupState(state, 10) || state.payload?.telegramId !== telegramId) return null
  const candidates: any[] = Array.isArray(state.payload?.candidates) ? state.payload.candidates : []
  const index = (m[1] ? Number(m[1]) : ORDINALS[String(m[2]).toLowerCase()]) - 1
  const chosen = candidates[index]
  if (!chosen) return null
  await clearFollowupState(telegramId, CHOICE_STATE)
  const answer = classifyDetailAnswer(String(state.payload?.answer || ''))
  if (chosen.source === 'legacy') {
    // Close the competing registry questions so the legacy follow-up owns the next time reply.
    for (const c of candidates) if (c.source === 'registry' && c.id) await closePendingQuestion(telegramId, String(c.id))
    return { text: `Got it, that's for: ${chosen.label}. Send the time once more (for example *8 pm*) and I'll finish it.`, handledBy: 'pending-question-choice', status: 'paused' }
  }
  const open = (await listOpenPendingQuestions(telegramId)).find((q) => q.id === chosen.id)
  if (!open || !answer || !questionAccepts(open, answer) || !RESUMERS[open.kind]) {
    return { text: 'That earlier question has expired, so nothing was changed. Tell me again what you would like to do.', handledBy: 'pending-question-choice', status: 'paused' }
  }
  return resume(params, open, answer)
}

async function resume(params: { actor: AgentActor; surface: PendingQuestionSurface; messageId?: string | number | null }, question: PendingQuestion, answer: DetailAnswer): Promise<ResolverResult | null> {
  await closePendingQuestion(params.actor.legacyTelegramId, question.id)
  try {
    const result = await RESUMERS[question.kind]({ actor: params.actor, surface: params.surface, question, answer, messageId: params.messageId })
    return result || { text: "I couldn't continue that request from your answer. Please send the full request again. Nothing was booked.", handledBy: 'pending-question-resume-failed', status: 'paused', questionId: question.id }
  } catch (err: any) {
    console.error('PENDING_QUESTION_RESUME_FAILED:', question.kind, err?.message || err)
    return { text: "I couldn't continue that request just now. Nothing was booked or set. Please try again in a moment.", handledBy: 'pending-question-resume-failed', status: 'failed', questionId: question.id }
  }
}

/**
 * Resolve a reply against the open questions for this user. Returns null whenever the reply is
 * not a detail answer or nothing (or only a legacy follow-up) is waiting for it.
 */
export async function tryResolvePendingQuestion(params: {
  user: { telegramId: number }
  text: string
  surface: PendingQuestionSurface
  actor: AgentActor
  messageId?: string | number | null
}): Promise<ResolverResult | null> {
  try {
    const telegramId = params.actor?.legacyTelegramId
    // Owner binding: the session user and the actor must be the same person.
    if (!Number.isFinite(telegramId) || params.user?.telegramId !== telegramId) return null
    const text = String(params.text || '').trim()
    if (!text) return null

    const choice = await tryResolveChoice({ actor: params.actor, surface: params.surface, text, messageId: params.messageId })
    if (choice) return choice

    const answer = classifyDetailAnswer(text)
    if (!answer) return null
    const open = await listOpenPendingQuestions(telegramId)
    const registry: Candidate[] = open
      .filter((q) => RESUMERS[q.kind] && questionAccepts(q, answer))
      .map((q) => ({ source: 'registry' as const, question: q, label: questionLabel(q) }))
    if (!registry.length) return null
    const legacy = await legacyCandidates(telegramId, text, answer)
    const candidates = [...registry, ...legacy]
    if (candidates.length > 1) return askWhich(telegramId, answer, candidates)
    const only = registry[0] as Extract<Candidate, { source: 'registry' }>
    return resume(params, only.question, answer)
  } catch (err: any) {
    console.error('PENDING_QUESTION_RESOLVE_FAILED:', err?.message || err)
    return null
  }
}
