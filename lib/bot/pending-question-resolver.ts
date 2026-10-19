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
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guestNameFromReply } from '@/lib/agent/reservation-guest-name'
import {
  closePendingQuestion,
  openPendingQuestion,
  isLatestAssistantTurn,
  listOpenPendingQuestions,
  readRecentTurns,
  type ConversationTurn,
  type PendingDetail,
  type PendingQuestion,
} from './pending-questions'

/**
 * Binds a short reply to the question Gogo just asked (PR 1 of the understand-first router).
 *
 * "This Saturday 8pm" right after "What time should I book Toit for?" is the answer to that
 * question, not a new reminder. Like a person, it only treats a reply as an answer to the question
 * Gogo asked LAST: once Gogo has said anything else (a flight question, a list, a reminder), the
 * older question no longer claims short replies. The resolver:
 *   1. reads the reply as a DETAIL answer (bare date/time, party size, or a venue-shaped restaurant
 *      name when a restaurant was literally asked for) — anything else returns null with ZERO
 *      database reads, and routing continues;
 *   2. finds the fresh open registry question that expects that detail AND whose asking reply is
 *      still Gogo's latest assistant message to this user (no later turn in between);
 *   3. collects competing legacy follow-ups (pending_reminder / pending_calendar / reminder_ampm /
 *      friend-time / calendar_mutation pick). A legacy or flight question saved AFTER the registry
 *      question supersedes it (null); an older fresh one competes;
 *   4. exactly one candidate → close it and hand the answer to that kind's RESUMER; two or more →
 *      ask which one (never guess); none → null.
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
  /** A person's name ("Goverdhan", "book under Divya") — only binds when a guest name was the detail asked. */
  guestName: string
}

export type PendingQuestionSurface = AgentSurface | 'telegram'

export type ResolverResult = {
  text: string
  handledBy: string
  status?: string
  runId?: string
  capability?: string
  questionId?: string
  /**
   * Set when the reply binds no registered question but picks exactly one option Gogo just offered
   * ("24k" right after "22K or 24K gold?"). The caller routes this full request in place of the bare
   * reply; `text` is empty and nothing has been done yet.
   */
  rewrite?: string
}

export type ResumerArgs = {
  actor: AgentActor
  surface: PendingQuestionSurface
  question: PendingQuestion
  answer: DetailAnswer
  messageId?: string | number | null
}

export type PendingQuestionResumer = (args: ResumerArgs) => Promise<ResolverResult | null>

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
}
const N = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)'
// "for 8 pm" / "for 8:30" is a time, never a party of 8.
const NOT_CLOCK = '(?!\\s*(?:am|pm|[:.]\\d))'
const PARTY_UNITS = '(?:people|persons?|guests?|pax|adults|of\\s+us)'
// The classifier and the merge strip share these exact forms, so whatever is read as the party is
// also what is replaced in the original request ("table for four" + "for 6" → 6, never "four … 6").
const PARTY_FORMS = [
  `\\b(?:a\\s+)?(?:party|group)\\s+of\\s+${N}\\b${NOT_CLOCK}`,
  `\\b(?:a\\s+)?(?:table\\s+)?for\\s+${N}\\b${NOT_CLOCK}(?:\\s+${PARTY_UNITS})?`,
  `\\b(?:we\\s+are|we['’]re)\\s+${N}\\b${NOT_CLOCK}`,
  `\\b${N}\\s+${PARTY_UNITS}\\b`,
]
const PARTY_PATTERNS = PARTY_FORMS.map((f) => new RegExp(f, 'i'))
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const WEEKDAY = '(?:mon|tues|wednes|thurs|fri|satur|sun)day'
const TIME_RE = /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\bat\s+\d{1,2}\b|\b(?:noon|midnight)\b/i
// Date forms the classifier accepts; DATE_STRIP below removes exactly these from the original request.
const DATE_FORMS = [
  `\\b(?:on\\s+)?(?:(?:this|next|coming)\\s+)?${WEEKDAY}\\b`,
  `\\b(?:day\\s+after\\s+tomorrow|today|tonight|tomorrow|tmrw|tmr)\\b`,
  `\\b(?:(?:on|over)\\s+)?(?:the\\s+)?(?:(?:this|next|coming)\\s+)?weekend\\b`,
  `\\b(?:on\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b(?:[ ,]+20\\d{2}\\b)?`,
  `\\b(?:on\\s+)?${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:[ ,]+20\\d{2}\\b)?`,
  `\\b20\\d{2}-\\d{1,2}-\\d{1,2}\\b`,
]
const DATE_RE = new RegExp(DATE_FORMS.join('|'), 'i')
const CHIT_CHAT_START = /^(?:ok(?:ay)?|k|yes|yeah|yep|yup|no|nope|nah|thanks?|thank\s+you|thx|ty|cool|great|nice|sure|fine|hmm+|hi|hello|hey|cancel|stop|never\s*mind|nevermind|forget\s+it|later|done|approve[ds]?|reject(?:ed)?|confirm(?:ed)?|wait|what|why|how|who|when|where|which|lol|haha+|good|perfect|awesome|got\s+it|go\s+ahead|continue|resume|status|help|menu)\b/i

// A restaurant answer is a NAME. Replies that defer, decline, chat, command, list or name a person,
// a city or an everyday place are not ("not now", "call mom", "Mom", "Gym", "milk eggs bread",
// "Bangalore"); those return null here and a later understanding pass (PR 2) may read them.
const NAME_REJECT_WORDS = /\b(?:not|now|later|never|mind|no|nope|nah|cancel|stop|busy|thanks?|thank|thx|ty|ok|okay|sure|sounds|good|great|fine|yes|yeah|yep|yup|maybe|forget|wait|sorry|hmm+|lol|haha+|please|pls|done|skip|whatever|anything|anywhere|idk|dunno|morning|evening|night|hi|hello|hey)\b/i
const NAME_REJECT_PRONOUNS = /(?:^|\s)(?:i|i['’]m|im|i['’]ll|i['’]ve|i['’]d|me|my|mine|we|we['’]re|us|our|you|your|u|he|she|they|them|his|her|their|it|that|this|those|these)(?=\s|$)/i
const NAME_COMMAND_VERBS = new Set(['call', 'text', 'message', 'msg', 'email', 'mail', 'buy', 'get', 'add', 'remind', 'book', 'reserve', 'show', 'send', 'check', 'go', 'make', 'set', 'pay', 'order', 'find', 'search', 'play', 'open', 'tell', 'ask', 'pick', 'take', 'meet', 'visit', 'cook', 'clean', 'watch', 'read', 'write', 'start', 'schedule', 'delete', 'remove', 'list', 'track', 'move', 'change', 'update', 'note', 'save', 'share', 'track', 'cancel', 'stop', 'do', 'need', 'want', 'let', 'lets', 'see', 'look', 'help', 'what', 'why', 'how', 'who', 'when', 'where', 'which', 'is', 'are', 'can', 'could', 'should', 'will', 'would'])
const NAME_STOPWORDS = new Set([
  // people and everyday places
  'mom', 'mum', 'mummy', 'mama', 'amma', 'dad', 'papa', 'appa', 'mother', 'father', 'wife', 'husband', 'son', 'daughter', 'brother', 'sister', 'bro', 'sis', 'boss', 'friend', 'friends', 'family', 'kids', 'baby',
  'gym', 'home', 'house', 'office', 'work', 'school', 'college', 'class', 'hospital', 'doctor', 'dentist', 'airport', 'station', 'mall', 'market', 'park', 'temple', 'church', 'bank', 'meeting',
  // cities and areas (a place, not a venue)
  'bangalore', 'bengaluru', 'mumbai', 'bombay', 'delhi', 'chennai', 'hyderabad', 'pune', 'kolkata', 'goa', 'dubai', 'india', 'koramangala', 'indiranagar', 'jayanagar', 'whitefield', 'hsr', 'btm', 'rajajinagar', 'malleshwaram', 'hebbal', 'yelahanka', 'marathahalli', 'jp',
  // apps, meals and generic food
  'swiggy', 'zomato', 'uber', 'ola', 'google', 'whatsapp', 'amazon', 'flipkart', 'dineout', 'eazydiner',
  'lunch', 'dinner', 'breakfast', 'brunch', 'food', 'pizza', 'biryani', 'burger', 'coffee', 'tea', 'chai', 'beer', 'drinks', 'milk', 'eggs', 'bread', 'groceries', 'weather', 'reminder', 'reminders',
])
const NAME_CONNECTORS = new Set(['of', 'the', 'and', '&', 'by', 'at', 'de', 'la', 'le', 'el', 'n', "'n'", 'on', 'du', 'da'])
const VENUE_WORD = /\b(?:restaurant|resto|cafe|café|bar|pub|brewery|brewpub|brewing|brew|bistro|kitchen|grill|diner|dhaba|social|taproom|eatery|bakery|lounge|canteen|bhavan|bhawan|sagar|darshini|hotel|tavern|trattoria|pizzeria|cantina|brasserie|steakhouse|tiffins?|mess|udupi|club)\b/i

/** True only for a short reply that reads like a venue name ("Toit", "Toit Indiranagar", "The Fatty Bao"). */
export function looksLikeVenueName(name: string): boolean {
  const value = String(name || '').trim()
  if (!value || value.length > 60 || !/\p{L}/u.test(value)) return false
  if (/[,;+/|\n]/.test(value)) return false
  // A venue name has a real word: "24k", "22K", "10%" or "5kg" is a choice or a quantity, never a restaurant.
  if (!value.split(/\s+/).some((w) => /^\p{L}{2,}/u.test(w.replace(/^[^\p{L}\p{N}]+/u, '')))) return false
  const words = value.split(/\s+/).filter(Boolean)
  if (words.length > 5) return false
  if (CHIT_CHAT_START.test(value) || NAME_REJECT_WORDS.test(value) || NAME_REJECT_PRONOUNS.test(value)) return false
  const first = words[0].toLowerCase().replace(/[^\p{L}']/gu, '')
  if (NAME_COMMAND_VERBS.has(first)) return false
  if (TIME_RE.test(value) || DATE_RE.test(value) || looksLikeNewCommand(value)) return false
  const bare = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}&']/gu, ''))
  // One everyday word ("Mom", "Gym", "Bangalore") or a phrase made only of them is not a venue.
  if (bare.every((w) => !w || NAME_STOPWORDS.has(w) || NAME_CONNECTORS.has(w))) return false
  if (VENUE_WORD.test(value)) return true
  // Otherwise it must look like a proper name: every non-connector word capitalized (or a number).
  const capitalized = words.filter((w, i) => !NAME_CONNECTORS.has(bare[i]) || i === 0)
  return capitalized.length > 0 && capitalized.every((w) => /^[\p{Lu}\p{N}]/u.test(w))
}

/**
 * A person's name for a booking ("Goverdhan", "Divya Rao", "book under Divya"), stricter than the shape check
 * alone: a command, a list item or an everyday word is never a guest name ("add milk to groceries", "Mom").
 */
export function personNameFromReply(text: string): string {
  const name = guestNameFromReply(text)
  if (!name) return ''
  const words = name.split(/\s+/)
  if (words.length > 3 || CHIT_CHAT_START.test(name) || NAME_REJECT_WORDS.test(name) || looksLikeNewCommand(name)) return ''
  const bare = words.map((w) => w.toLowerCase().replace(/[^\p{L}']/gu, ''))
  if (NAME_COMMAND_VERBS.has(bare[0]) || bare.some((w) => NAME_STOPWORDS.has(w) || NAME_CONNECTORS.has(w))) return ''
  return name
}

function toNumber(raw: string): number | null {
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw.toLowerCase()]
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null
}

/** Reads a reply as a detail answer, or null when it is anything more than a detail. */
export function classifyDetailAnswer(text: string): DetailAnswer | null {
  const raw = String(text || '').trim().replace(/[.!]+$/, '').trim()
  if (!raw || raw.length > 80 || /[\n?]/.test(raw)) return null
  const empty = { raw, details: new Set<PendingDetail>(), when: '', party: null, bareNumber: null, name: '', guestName: '' }
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
      // Free text: only a short venue-shaped reply can answer a restaurant question, and only a short
      // person-name reply can answer a guest-name question. Which one binds is decided by what was asked.
      const venue = restClean.replace(/^(?:at|in|it'?s|its|try)\s+/i, '').trim()
      const name = looksLikeVenueName(venue) ? venue : ''
      const guestName = personNameFromReply(restClean)
      if (!name && !guestName) return null
      return { ...empty, name, guestName }
    } else {
      // "for 4 at Toit" mixes a party with free text; let routing read the whole sentence.
      return null
    }
  }
  if (!details.size) return null
  return { raw, details, when: (details.has('date') || details.has('time')) ? restClean : '', party, bareNumber: null, name: '', guestName: '' }
}

/** A free-text name binds only to a restaurant question asked within the last 10 minutes. */
const NAME_BIND_MAX_MS = 10 * 60_000

function questionAccepts(q: PendingQuestion, a: DetailAnswer, now = Date.now()): boolean {
  if (a.bareNumber !== null) return q.expects[0] === 'party'
  if (a.name || a.guestName) {
    if (a.guestName && q.expects[0] === 'guest_name') return true
    return Boolean(a.name) && q.expects[0] === 'restaurant' && !q.exactOnly && now - Date.parse(q.createdAt) <= NAME_BIND_MAX_MS
  }
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
const DATE_STRIP = DATE_FORMS.map((f) => new RegExp(f, 'gi'))
// Same forms as PARTY_FORMS, but "table for four" keeps the word "table" so the request still reads as a reservation.
const PARTY_STRIP = PARTY_FORMS.map((f) => new RegExp(f.replace('(?:a\\s+)?(?:table\\s+)?for', 'for'), 'gi'))

function tidy(text: string) {
  return text.replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').replace(/([,.;])\s*[,.;]+/g, '$1').trim()
    .replace(/(?:[,;]\s*|\s+(?:on|at|for|by|around|or|and))+$/i, '').replace(/[,.;!?]+$/, '').trim()
}

/** The answer's date/time with "at" before its clock, so the reservation parser reads it as the dining time. */
function canonicalWhen(raw: string) {
  if (!raw) return ''
  // The reservation parser reads "26 Oct" but not "Oct 26": put the day first.
  const when = raw.replace(new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(st|nd|rd|th)?\\b`, 'i'), '$2$3 $1')
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

/**
 * The live-slot step ("7pm tomorrow is available … What name should I book under?" / "Open times: … Which one
 * should I book?"). The registry is its only entry: continueRestaurantReservationGuestReply claims the paused step
 * atomically and goes through the same bounded approval as every reservation; nothing is submitted here.
 */
async function resumeReservationLiveSlot({ actor, surface, question, answer }: ResumerArgs): Promise<ResolverResult | null> {
  const rr = await import('@/lib/agent/restaurant-reservation')
  const result = await rr.continueRestaurantReservationGuestReply({ actor, surface: surface === 'telegram' ? 'web' : surface, text: answer.raw })
  if (result) {
    return {
      text: String(result.text || ''),
      handledBy: String((result as any).handledBy || 'restaurant-reservation'),
      status: (result as any).status ? String((result as any).status) : undefined,
      runId: (result as any).runId ? String((result as any).runId) : undefined,
      capability: 'browser',
      questionId: question.id,
    }
  }
  const label = String(question.context?.label || 'the table').replace(/\s*\((?:guest name|time)\)$/, '')
  if (question.expects[0] === 'time') {
    // A time that was not offered: the step is unchanged, so ask again and keep this the question on the table.
    const text = `I can only book one of the open times I listed for ${label.replace(/^Table at /, '')}. Which one should I book? Nothing is booked yet.`
    await openPendingQuestion({ telegramId: actor.legacyTelegramId, kind: question.kind, capability: question.capability, expects: question.expects, context: question.context, ttlMin: 30, exactOnly: true, askedText: text })
    return { text, handledBy: 'restaurant-reservation', status: 'paused', capability: 'browser', questionId: question.id }
  }
  return { text: `That table hold has expired, so nothing was booked. Send the reservation request again and I'll re-check the live times.`, handledBy: 'restaurant-reservation', status: 'paused', capability: 'browser', questionId: question.id }
}

/** One resumer per question kind. A kind without a resumer is never bound. */
export const RESUMERS: Record<string, PendingQuestionResumer> = {
  reservation_slot: resumeReservationSlot,
  reservation_live_slot: resumeReservationLiveSlot,
}

// ── Competing follow-ups ───────────────────────────────────────────────────────

type Candidate = { source: 'registry'; question: PendingQuestion; label: string } | { source: 'legacy'; kind: string; label: string }

function questionLabel(q: PendingQuestion): string {
  const label = String(q.context?.label || '').trim()
  if (label) return label
  return `${q.capability || q.kind} (${q.expects[0] || 'detail'})`
}

function stateTime(state: any): number {
  return Date.parse(String(state?.created_at || state?.payload?.created_at || ''))
}

/**
 * Other follow-ups that could also own this reply. A follow-up saved AFTER the registry question
 * means Gogo asked something newer (even if that turn failed to save to conversations): the
 * registry question is superseded. An older, still-fresh follow-up competes, and the user is asked.
 *
 * Flight/travel clarifications and flight traveller-detail questions are read from agent_activity;
 * they bind only while they are the latest assistant turn themselves, so they can never be resumed
 * from an older position: newer → supersede, older → not a candidate.
 */
async function competingFollowups(telegramId: number, text: string, answer: DetailAnswer, question: PendingQuestion): Promise<{ superseded: boolean; legacy: Candidate[] }> {
  const askedAt = Date.parse(question.createdAt)
  const legacy: Candidate[] = []
  let superseded = false
  const consider = (state: any, fresh: boolean, candidate: Candidate | null) => {
    if (!state || !fresh) return
    if (stateTime(state) > askedAt) { superseded = true; return }
    if (candidate) legacy.push(candidate)
  }
  try {
    const timeAnswer = answer.details.has('date') || answer.details.has('time')
    if (timeAnswer && !looksLikeNewCommand(text)) {
      const r = await getLatestFollowupState(telegramId, 'pending_reminder')
      consider(r, Boolean(r) && isFreshFollowupState(r), { source: 'legacy', kind: 'pending_reminder', label: r?.payload?.task ? `Reminder: ${String(r.payload.task).slice(0, 60)}` : 'Reminder (time)' })
      const c = await getLatestFollowupState(telegramId, 'pending_calendar')
      consider(c, Boolean(c) && isFreshFollowupState(c), { source: 'legacy', kind: 'pending_calendar', label: `Calendar event: ${String(c?.payload?.title || 'meeting').slice(0, 60)}` })
    }
    if (timeAnswer && isAmPmChoice(text)) {
      const a = await getLatestFollowupState(telegramId, 'reminder_ampm')
      consider(a, Boolean(a?.payload?.originalText) && isFreshFollowupState(a), { source: 'legacy', kind: 'reminder_ampm', label: 'Reminder (am or pm)' })
    }
    if (timeAnswer && isFriendReminderFollowupCandidate(text)) {
      const f = await getPendingFriend(telegramId)
      if (f && f.stage === 'time') legacy.push({ source: 'legacy', kind: 'friend_time', label: `Reminder for ${f.name}` })
    }
    // A numbered calendar pick ("which one to move? 1. … 2. …") waits for a digit.
    if (answer.bareNumber !== null) {
      const m = await getLatestFollowupState(telegramId, 'calendar_mutation')
      const p = m?.payload
      const live = Boolean(p) && !p.consumed && isStrictlyFreshFollowupState(m, 10)
      const picks = Array.isArray(p?.candidates) && answer.bareNumber <= p.candidates.length
      consider(m, live, picks ? { source: 'legacy', kind: 'calendar_mutation', label: `Calendar: pick the event to ${p?.action === 'delete' ? 'delete' : 'move'}` } : null)
    }
    const { data: flight } = await supabaseAdmin
      .from('agent_activity')
      .select('event_type,metadata_json,created_at')
      .eq('telegram_id', String(telegramId))
      .in('event_type', ['travel_clarification', 'flight_booking_details'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const flightAt = Date.parse(String((flight as any)?.metadata_json?.at || (flight as any)?.created_at || ''))
    if (Number.isFinite(flightAt) && flightAt > askedAt && Date.now() - flightAt <= 30 * 60_000) superseded = true
  } catch (err: any) {
    console.error('PENDING_QUESTION_LEGACY_READ_FAILED:', err?.message || err)
  }
  return { superseded, legacy }
}

// ── Disambiguation ("which one?") ──────────────────────────────────────────────

const CHOICE_STATE = 'pending_question_choice'
const CHOICE_RE = /^\s*(?:#|no\.?\s*|option\s+)?([1-9])\s*[.)]?\s*$|^\s*(?:the\s+)?(first|second|third|fourth)(?:\s+one)?\s*[.!]?\s*$/i
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 }

async function askWhich(telegramId: number, answer: DetailAnswer, candidates: Candidate[]): Promise<ResolverResult> {
  const shown = candidates.slice(0, 4)
  const lines = shown.map((c, i) => `${i + 1}. ${c.label}`).join('\n')
  const text = `I have more than one open question, so I won't guess. Which one is “${answer.raw}” for?\n${lines}\n\nReply with the number. Nothing has been booked or set yet.`
  await saveFollowupState(telegramId, CHOICE_STATE, {
    telegramId,
    answer: answer.raw,
    // The choice binds only the very next reply: it is live only while this text is Gogo's latest turn.
    askedText: text,
    candidates: shown.map((c) => (c.source === 'registry' ? { source: 'registry', id: c.question.id, label: c.label } : { source: 'legacy', kind: c.kind, label: c.label })),
    created_at: new Date().toISOString(),
  })
  return { text, handledBy: 'pending-question-ambiguous', status: 'paused' }
}

type Turns = () => Promise<ConversationTurn[] | null>

async function tryResolveChoice(params: { actor: AgentActor; surface: PendingQuestionSurface; text: string; messageId?: string | number | null }, turns: Turns): Promise<ResolverResult | null> {
  const m = params.text.match(CHOICE_RE)
  if (!m) return null
  const telegramId = params.actor.legacyTelegramId
  const state = await getLatestFollowupState(telegramId, CHOICE_STATE)
  if (!state || !isStrictlyFreshFollowupState(state, 10) || state.payload?.telegramId !== telegramId) return null
  // "Which one?" owns only the immediately next message. Once Gogo has said anything else, a digit
  // belongs to whatever was asked last (a calendar pick, a list), never to this old choice.
  if (!isLatestAssistantTurn(await turns(), String(state.payload?.askedText || ''), params.text, 10)) {
    await clearFollowupState(telegramId, CHOICE_STATE)
    return null
  }
  const candidates: any[] = Array.isArray(state.payload?.candidates) ? state.payload.candidates : []
  const index = (m[1] ? Number(m[1]) : ORDINALS[String(m[2]).toLowerCase()]) - 1
  const chosen = candidates[index]
  if (!chosen) return null
  await clearFollowupState(telegramId, CHOICE_STATE)
  const answer = classifyDetailAnswer(String(state.payload?.answer || ''))
  if (chosen.source === 'legacy') {
    // Close the competing registry questions so the legacy follow-up owns the next reply.
    for (const c of candidates) if (c.source === 'registry' && c.id) await closePendingQuestion(telegramId, String(c.id))
    const again = chosen.kind === 'calendar_mutation' ? 'Send the event number once more (for example *1*)' : 'Send the time once more (for example *8 pm*)'
    return { text: `Got it, that's for: ${chosen.label}. ${again} and I'll finish it.`, handledBy: 'pending-question-choice', status: 'paused' }
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

// ── Offered choice ("22K or 24K gold?" → "24k") ───────────────────────────────

/**
 * A question Gogo wrote in free text (often model-written, so never registered) that offers options:
 * "Which purity, 22K or 24K gold?" → ["22K", "24K gold"]. Conservative: only short options (≤3 words)
 * joined by "or", read from the last question in the message. Anything else → [].
 */
export function offeredOptions(message: string): string[] {
  const questions = String(message || '').match(/[^.!?\n]*\?/g)
  if (!questions?.length) return []
  const q = questions[questions.length - 1].replace(/\?$/, '').trim()
  const tail = q.split(/[:—–]|\s-\s/).pop() || ''
  if (!/\sor\s/i.test(tail)) return []
  const pieces = tail.split(/\s+or\s+/i)
  const items: string[] = []
  pieces.forEach((piece, i) => {
    const sub = piece.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean)
    for (const x of i === 0 ? sub.slice(-1) : sub) items.push(x)
  })
  const words = (x: string) => x.split(/\s+/).filter(Boolean)
  const kind = (w: string) => (/\d/.test(w) ? 'digit' : 'alpha')
  // The option before the first "or" is the end of a longer clause ("Do you want 22K"): keep its last word
  // only when it has the same shape as the option after "or" ("24K gold").
  if (items.length >= 2 && words(items[0]).length > 3) {
    const last = words(items[0]).slice(-1)[0] || ''
    items[0] = kind(last) === kind(words(items[1])[0] || '') ? last : ''
  }
  const options = items.map((x) => x.replace(/^(?:either|the|a|an)\s+/i, '').replace(/[\s,;]+$/, '').trim())
  if (options.length < 2 || options.some((o) => !o || words(o).length > 3 || !/[\p{L}\p{N}]/u.test(o))) return []
  return options
}

const optionTokens = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)

/** Cheap, DB-free gate: a short, plain reply that could pick an offered option (never a command or a question). */
export function mayPickOfferedChoice(text: string): boolean {
  const t = String(text || '').trim().replace(/[.!]+$/, '').trim()
  if (!t || t.length > 30 || /[?\n]/.test(t) || !/\p{L}/u.test(t)) return false
  const w = optionTokens(t)
  if (!w.length || w.length > 3) return false
  if (CHIT_CHAT_START.test(t) || NAME_COMMAND_VERBS.has(w[0]) || looksLikeNewCommand(t)) return false
  // Deferring or declining ("not now", "maybe later") picks nothing.
  if (/\b(?:not|never|maybe|later|cancel|stop|no|nope|nah|skip|whatever|anything|idk|dunno|mind|thanks?|thx)\b/i.test(t)) return false
  return true
}

/**
 * The full request a short reply completes, or null. Binds like a person: only when Gogo's LATEST message
 * (≤10 minutes old, nothing said since) asks a question offering options, the reply picks exactly one of
 * them, and that question followed a request from the user. "24k" after "22K or 24K gold?" (asked about
 * "gold rate today") → "gold rate today — 24K gold". Approval prompts are never answered this way.
 */
export function offeredChoiceRewrite(turns: ConversationTurn[] | null, text: string, now = Date.now()): string | null {
  if (!turns || !mayPickOfferedChoice(text)) return null
  const latest = turns.find((t) => t.role === 'assistant')
  if (!latest) return null
  const at = Date.parse(String(latest.created_at || ''))
  if (!Number.isFinite(at) || now - at < -60_000 || now - at > 10 * 60_000) return null
  const reply = String(text).trim().replace(/[.!]+$/, '').trim()
  const norm = (x: string) => optionTokens(x).join(' ')
  if (turns.some((t) => t.role === 'user' && Date.parse(String(t.created_at || '')) > at && norm(t.content) !== norm(reply))) return null
  if (/\b(?:approve|reject)\b/i.test(String(latest.content || ''))) return null
  const options = offeredOptions(String(latest.content || ''))
  if (!options.length) return null
  const r = optionTokens(reply)
  const matches = options.filter((o) => {
    const ot = optionTokens(o)
    return ot.join(' ') === r.join(' ') || (r.length === 1 && r[0] === ot[0]) || (ot.length === 1 && r[0] === ot[0] && r.length <= 2)
  })
  if (matches.length !== 1) return null
  let choice = matches[0]
  // "22K or 24K gold" shares the trailing noun: "22k" means "22K gold".
  const lastOpt = options[options.length - 1]
  if (choice !== lastOpt && optionTokens(choice).length === 1 && optionTokens(lastOpt).length > 1) choice = `${choice} ${lastOpt.split(/\s+/).slice(1).join(' ')}`
  const request = turns.find((t) => t.role === 'user' && Date.parse(String(t.created_at || '')) <= at)
  const original = String(request?.content || '').trim().replace(/[\s?.!]+$/, '')
  if (!original || original.length > 300 || norm(original) === norm(reply)) return null
  return `${original} — ${choice}`
}

/** Cheap, DB-free gate: could this message possibly be a choice digit or a detail answer? */
export function mayAnswerPendingQuestion(text: string): boolean {
  const t = String(text || '').trim()
  return Boolean(t) && (CHOICE_RE.test(t) || classifyDetailAnswer(t) !== null || mayPickOfferedChoice(t))
}

/**
 * Resolve a reply against the open questions for this user. Returns null whenever the reply is
 * not an answer, or no open question is the one Gogo asked last, or something newer supersedes it.
 * Order: a "which one?" digit; then a registered question (reservation details, the live-slot
 * name/time step) that is Gogo's latest message; then, only for free text, an option Gogo just
 * offered (returned as `rewrite` for the caller to route). Runs once per turn: the WhatsApp webhook
 * and dashboard call it, then pass pendingQuestionChecked to processIncomingMessage so the shared
 * path does not repeat the reads.
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
    // Fast path: no database read for a message that cannot be an answer.
    const isChoice = CHOICE_RE.test(text)
    const answer = classifyDetailAnswer(text)
    // Only free text may pick an offered option; dates, times and numbers keep their own follow-ups.
    const mayOffer = (!answer || (!answer.details.size && answer.bareNumber === null)) && mayPickOfferedChoice(text)
    if (!isChoice && !answer && !mayOffer) return null

    let cachedTurns: Promise<ConversationTurn[] | null> | null = null
    const turns: Turns = () => (cachedTurns ||= readRecentTurns(telegramId))

    if (isChoice) {
      const choice = await tryResolveChoice({ actor: params.actor, surface: params.surface, text, messageId: params.messageId }, turns)
      if (choice) return choice
    }

    if (answer) {
      const accepting = (await listOpenPendingQuestions(telegramId)).filter((q) => RESUMERS[q.kind] && questionAccepts(q, answer))
      if (accepting.length) {
        // Only the question Gogo asked LAST may claim a short reply (19 Oct review: after a Toit
        // "how many people?", the user moved to a flight and "2 adults" resumed Toit).
        const recent = await turns()
        const current = accepting.filter((q) => isLatestAssistantTurn(recent, q.askedText, text))
        if (recent) {
          // A question that is no longer the latest turn can never become current again: close it.
          for (const q of accepting) if (!current.includes(q) && recent.some((t) => t.role === 'assistant')) await closePendingQuestion(telegramId, q.id)
        }
        if (current.length) {
          const question = current[0]
          const { superseded, legacy } = await competingFollowups(telegramId, text, answer, question)
          if (superseded) {
            await closePendingQuestion(telegramId, question.id)
            return null
          }
          const candidates: Candidate[] = [{ source: 'registry', question, label: questionLabel(question) }, ...legacy]
          if (candidates.length > 1) return askWhich(telegramId, answer, candidates)
          return resume(params, question, answer)
        }
      }
    }

    if (mayOffer) {
      const rewrite = offeredChoiceRewrite(await turns(), text)
      if (rewrite) return { text: '', handledBy: 'pending-question-offered-choice', rewrite }
    }
    return null
  } catch (err: any) {
    console.error('PENDING_QUESTION_RESOLVE_FAILED:', err?.message || err)
    return null
  }
}
