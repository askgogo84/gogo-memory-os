// Phone calls through Bolna (voice agent) + Plivo (+91 number). Approved mock: "Online booking blocked: offer a call"
// (docs/architecture/08-booking-engine.md, P6). Rules:
//   - Gogo only calls after the person's explicit yes to a call plan that shows the number, the script and the limits.
//   - The agent says it is an AI assistant first, never pays, shares card details or agrees to a deposit.
//   - The result is reported honestly from the transcript; "booked" only when the venue said yes on the call.
//   - No automatic redial loop: the person can say "call again" (at most 2 redials per plan).
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { beginApprovedVoiceCall, voicePlanHash, voiceAttemptId } from './voice-call-execution'
import { capabilityPaused, capabilityPausedText } from './policy'

import type { CallLanguage } from './voice-call-language'

const BOLNA = 'https://api.bolna.ai'
// v3 (21 Nov): phone-menu rule. A new name makes Bolna create the agent with the new instructions on the next call.
export const CALL_AGENT_NAME = 'AskGogo booking caller v3'
// 17 Nov: a second agent for any other ask (room, appointment, enquiry). Its instructions come from the plan itself.
export const GENERAL_CALL_AGENT_NAME = 'AskGogo general caller v3'
export const DEFAULT_FROM_NUMBER = '+918065539020'
export const PLAN_STATE = 'voice_call_plan'
export const CALL_NUMBER_STATE = 'voice_call_number_needed'
export const MAX_REDIALS = 2

export function voiceCallsEnabled(env: Record<string, string | undefined> = process.env) {
  return Boolean(String(env.BOLNA_API_KEY || '').trim())
}

// ---- pure helpers -----------------------------------------------------------------------------------------------

/** An Indian phone number in text, as E.164 (+91…), or null. Landlines (080…) and mobiles. Pure. */
export function indianPhoneFrom(text: string): string | null {
  const t = String(text || '')
  const candidates = t.match(/(?:\+?91[\s-]?)?(?:0?[6-9]\d{4}[\s-]?\d{5}|0?(?:80|22|11|44|33|40|20)[\s-]?\d{4}[\s-]?\d{4})/g) || []
  for (const raw of candidates) {
    let d = raw.replace(/\D/g, '')
    if (d.startsWith('91') && d.length === 12) d = d.slice(2)
    if (d.startsWith('0')) d = d.slice(1)
    if (/^[6-9]\d{9}$/.test(d) || /^(?:80|22|11|44|33|40|20)\d{8}$/.test(d)) return '+91' + d
  }
  return null
}

export function displayPhone(e164: string) {
  // Bangalore landlines (80…) and mobiles share the 10-digit shape after +91, so one grouping fits both.
  const d = String(e164 || '').replace(/^\+91/, '')
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : String(e164 || '')
}

export type CallCommand = { kind: 'test'; number?: string } | { kind: 'book'; text: string } | { kind: 'approve' } | { kind: 'affirm' } | { kind: 'redial' } | { kind: 'decline' }

export const CALL_ASK_VERBS = 'book|reserve|schedule|reschedule|cancel|confirm|ask|enquire|inquire|check|find\\s+out|request|make|fix|get|tell|inform|let\\s+them\\s+know'
const CALL_ASK = new RegExp(`^(?:please\\s+)?(?:call|phone|ring)\\s+(?!me\\b)(?:up\\s+)?(.{2,80}?)\\s+(?:and|to)\\s+(${CALL_ASK_VERBS})\\b`, 'i')
const PERSONAL_CALLEE = /^(?:my\s+)?(?:mom|mum|mummy|mother|dad|daddy|father|amma|appa|papa|wife|husband|bro|brother|sis|sister|son|daughter|uncle|aunty|aunt|grandma|grandpa|friend|boss|him|her|them)\b/i
const BUSINESS_CALLEE = /\b(?:hospital|clinic|hotel|resort|inn|lodge|salon|parlou?r|spa|restaurant|cafe|bar|pub|dr\.?|doctor|dentist|dental|lab|labs|diagnostics?|pharmacy|chemist|bank|showroom|service\s+cent(?:er|re)|garage|gym|school|college|office|agency|airlines?|airways|travels|courier|store|shop|mart|bakery|caterers?|studio|vet|pet\s+clinic)\b/i
const TIMEY_CALLEE = /\b(?:today|tomorrow|tmrw|tonight|later|morning|afternoon|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*$|by\s+\d|\d{1,2}\s*(?:am|pm))\b/i
/** Pure. "Novotel on 83104 41698" → the name and the number. The number is read from this part only.
 *  Second review: a number that is typed but cannot be read (too short, too long, two numbers, an STD code we do not
 *  know) sets `unreadable`, and nothing is looked up or dialled in its place. */
export function calleeParts(raw: string): { name: string; phone: string | null; unreadable: boolean } {
  const text = String(raw || '').trim()
  const runs = text.match(/\+?\d[\d\s().-]{5,}\d/g) || []
  let phone: string | null = null, unreadable = runs.length > 1
  if (runs.length === 1) {
    const digits = runs[0].replace(/\D/g, '')
    const read = indianPhoneFrom(runs[0])
    const whole = read && (digits.length === 10 || (digits.length === 11 && digits.startsWith('0')) || (digits.length === 12 && digits.startsWith('91')))
    if (whole) phone = read; else unreadable = true
  }
  const name = text.replace(/\+?\d[\d\s().-]{5,}\d/g, ' ').replace(/[{}()]/g, ' ').replace(/\s+/g, ' ').replace(/[\s,;:.-]+$/g, '').replace(/\s+(?:on|at|via|number|no|or|and)$/i, '').replace(/[\s,;:.-]+$/g, '').replace(/^[\s,;:.-]+/, '').trim()
  return { name, phone, unreadable }
}
/** Pure. "the hotel", "my doctor", "school": not enough to look up a number; the person must say which one or give the number. */
export function genericCallee(name: string): boolean {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return true
  if (/^(?:the|my|our|a|an|that|this|some)\b/.test(n)) return true
  return n.split(/\s+/).length === 1 && BUSINESS_CALLEE.test(n)
}

/** "Call District 6 and book a table for 2 Saturday 8pm", "test call me", "yes call", "call again". Pure. */
// 20 Nov (handoff): "Can you call Novotel on … and book a room?" was not picked up. A polite lead-in before call/phone/ring
// is dropped (with a closing question mark) so every rule below reads the same sentence. Pure.
const CALL_LEAD = /^\s*(?:(?:hey|hi|ok(?:ay)?)\s+(?:gogo\s*)?[,!]?\s*|gogo[,!]?\s+)?(?:(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+|pls\s+|kindly\s+)?|(?:pls|kindly)\s+|i\s+(?:want|need|would\s+like)\s+you\s+to\s+)(?=(?:call|phone|ring)\b)/i
export function callLead(raw: string): string {
  const t = String(raw || '').trim()
  return CALL_LEAD.test(t) ? t.replace(CALL_LEAD, '').replace(/\s*\?+\s*$/, '').trim() : t
}
// A separate instruction avoids treating "ask whether the class is in Hindi" as a voice selection.
function callLanguageRequest(raw: string) {
  const match = /(?:[;,.]\s*|\n\s*)(?:please\s+)?speak\s+(?:in\s+)?([a-z]+)(?:\s+(?:on|during)\s+the\s+call)?[.!]?\s*$/i.exec(raw)
  if (!match) return null
  return { request:raw.slice(0,match.index).trim(), language:match[1].toLowerCase(), directive:match[0] }
}

export function parseCallCommand(raw: string): CallCommand | null {
  // The lead-in is dropped only for a new call request. "Can you call them?" is a question, never the yes to a shown plan.
  const led = callLead(raw)
  const t = String(raw || '').trim()
  const testText = callLanguageRequest(t)?.request ?? t
  const test = testText.match(/^(?:(?:do\s+a\s+)?test\s+call(?:\s+me)?|call\s+me\s+(?:to|for\s+a)\s+test|make\s+a\s+test\s+call)(?:\s+(?:on|at|to)\s+([+\d][\d\s-]{8,16}))?[.!]?$/i)
  if (test) { const n = test[1] ? indianPhoneFrom(test[1]) : null; return n ? { kind: 'test', number: n } : { kind: 'test' } }
  if (/^(?:yes[,!]?\s*)?(?:(?:please\s+)?(?:go\s+ahead\s+and\s+)?call(?:\s+them|\s+now)?|place\s+the\s+call|yes,?\s*call)[.!]?$/i.test(t) && /\bcall\b/i.test(t) && !/\bagain\b/i.test(t)) return { kind: 'approve' }
  // A bare yes only approves when Gogo's latest message is the call plan (checked in tryVoiceCall).
  if (/^(?:yes|yeah|yep|yup|ok|okay|sure|go\s+ahead|do\s+it|please\s+do|haan|ha)(?:\s+please)?[.!]*$/i.test(t)) return { kind: 'affirm' }
  if (/^(?:please\s+)?(?:call|try)\s+(?:them\s+)?again[.!]?$|^redial[.!]?$/i.test(t)) return { kind: 'redial' }
  if (/^(?:no|don'?t\s+call|do\s+not\s+call|cancel\s+(?:the\s+)?call)[.!]?$/i.test(t)) return { kind: 'decline' }
  if (/^(?:please\s+)?(?:call|phone|ring)\s+(?!me\b)(?:up\s+)?.{2,80}?\s+(?:and|to)\s+(?:book|reserve)\b/i.test(led)) return { kind: 'book', text: led }
  // 17 Nov (owner): calling works for any ask, not only a table. Other verbs need either a phone number in the message
  // or a business-looking name, so "call mom and ask about lunch tomorrow" stays an ordinary reminder.
  const ask = led.match(CALL_ASK)
  if (ask) {
    const callee = calleeParts(ask[1])
    // Review (PR #1534): the number must be in the "call <who>" part (never one mentioned later in the ask); a time word
    // there means a note to self ("call the dentist tomorrow to confirm"); a family word is never a business call.
    if (!TIMEY_CALLEE.test(ask[1]) && !PERSONAL_CALLEE.test(callee.name) && (callee.phone || callee.unreadable || BUSINESS_CALLEE.test(callee.name))) return { kind: 'book', text: led }
  }
  return null
}

export type CallPlan = {
  venue: string; to: string; source: string; guestName: string; partySize: number | null
  date: string | null; dateLabel: string; timeLabel: string; flexWindow: string; seating: string
  purpose: string; test: boolean; redials: number; createdAt: string; startClock?: string
  /** 'general' = any ask other than a restaurant table. `opening` is the first thing said; `details` is what may be shared. */
  kind?: 'table' | 'general'; opening?: string; details?: string
  callLanguage?: CallLanguage; voiceAgentId?: string
}

/** 9 am to 9 pm India time for an Indian number (GOGO_CALL_HOURS="9-21" to change). Another country's number has no
 *  known local time here, so it is not checked. Returns the message to send, or null when the call may go ahead. Pure. */
export function callingHoursProblem(to: string, now: Date, env: Record<string, string | undefined> = process.env): string | null {
  if (!/^\+91\d{10}$/.test(String(to || '').replace(/[\s-]/g, ''))) return null
  const m = String(env.GOGO_CALL_HOURS || '9-21').match(/^(\d{1,2})-(\d{1,2})$/)
  let start = m ? Math.min(23, Number(m[1])) : 9, end = m ? Math.min(24, Number(m[2])) : 21
  if (start >= end) { start = 9; end = 21 } // an overnight or empty window is not supported; keep the safe default
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const h = Number(parts.find(p => p.type === 'hour')?.value) % 24
  if (h >= start && h < end) return null
  const clock = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(now).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase()
  const fmt = (x: number) => x === 0 || x === 24 ? '12 am' : x === 12 ? '12 pm' : x < 12 ? `${x} am` : `${x - 12} pm`
  return `It's ${clock} in India, so I won't call now: I only place calls between ${fmt(start)} and ${fmt(end)}. Nothing was called. Ask me again after ${fmt(start)} and I'll show you a call plan.`
}

/** The approved mock's call-plan card as WhatsApp text. Pure. */
export function callPlanText(p: CallPlan) {
  if (p.kind === 'general') return [
    '*CALL PLAN · NEEDS YOUR YES*',
    ...(p.callLanguage ? [`Call language: ${p.callLanguage} (Sarvam via Bolna). The script below is shown in English.`] : []),
    `To: ${p.venue} · ${displayPhone(p.to)}${p.source ? ` (${p.source})` : ''}`,
    `From: ${displayPhone(DEFAULT_FROM_NUMBER)}`,
    `"Hi, I'm an AI assistant from AskGogo, calling for ${p.guestName}. ${p.opening || ''}"`,
    `What I'll do: ${p.purpose}`,
    `Details I may share: ${p.details || 'only what is above'}.`,
    `Name given on the call: ${p.guestName} (add "under the name …" to change it).`,
    "Won't pay, share card details or OTPs, or agree to an advance on the call. I won't give your phone number either. Anything they ask for beyond this, I'll say you will share yourself.",
  ].join('\n') + '\n\nReply *yes call* to place it, or *no* to skip.'
  const script = p.test
    ? `"Hi, I'm an AI assistant from AskGogo, calling for ${p.guestName}. This is a short test call so you can hear how I sound."`
    : `"Hi, I'm an AI assistant from AskGogo, calling for ${p.guestName}. Could I book a table for ${p.partySize || 2} ${p.dateLabel} at ${p.timeLabel}? If that's full, ${p.flexWindow} works."`
  const body = [
    '*CALL PLAN · NEEDS YOUR YES*',
    ...(p.callLanguage ? [`Call language: ${p.callLanguage} (Sarvam via Bolna). The script below is shown in English.`] : []),
    `To: ${p.venue} · ${displayPhone(p.to)}${p.source ? ` (${p.source})` : ''}`,
    `From: ${displayPhone(DEFAULT_FROM_NUMBER)}`,
    script,
    p.test ? '' : `Seating: ${p.seating}. Booking name: ${p.guestName} (add "under the name …" to change it).`,
    "Won't pay, share card details or agree to a deposit on the call.",
  ].filter(Boolean).join('\n')
  return `${body}\n\nReply *yes call* to place it, or *no* to skip.`
}

/** "between 7:30pm and 9pm" around the asked time (−30 / +60 minutes). Pure. */
export function flexWindowLabel(start: string, label: (clock: string) => string) {
  const [h, m] = String(start).split(':').map(Number)
  const at = (mins: number) => { const x = Math.max(0, Math.min(23 * 60 + 59, mins)); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}` }
  const base = h * 60 + m
  return `between ${label(at(base - 30))} and ${label(at(base + 60))}`
}

/** "8:00 pm" / "8pm" / "20:00" -> "20:00", else null. Pure. */
export function clock24(label: string | null | undefined): string | null {
  const m = String(label || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!m) return null
  let h = Number(m[1]); const min = Number(m[2] || 0); const ap = (m[3] || '').toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null
}

/** The booked start as an ISO instant (IST), or null when the date or time is unknown. Pure. */
export function bookedStartAt(plan: Pick<CallPlan, 'date' | 'startClock' | 'timeLabel'>, outcome: Pick<CallOutcome, 'confirmedTime'> | null): string | null {
  const clock = clock24(outcome?.confirmedTime) || plan.startClock || clock24(plan.timeLabel)
  if (!plan.date || !clock) return null
  const ms = Date.parse(`${plan.date}T${clock}:00+05:30`)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export type CallOutcome = { booked: boolean; confirmedTime: string | null; staffName: string | null; callbackAt: string | null; notes: string }

/** Parse the summariser's JSON; anything unclear counts as not booked. Pure. */
export function parseOutcome(json: string): CallOutcome | null {
  const m = String(json || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0])
    const confirmed = typeof o.confirmed_time === 'string' && o.confirmed_time ? o.confirmed_time : typeof o.confirmed === 'string' && o.confirmed ? o.confirmed.slice(0, 200) : null
    return { booked: o.booked === true || o.done === true, confirmedTime: confirmed,
      staffName: typeof o.staff_name === 'string' && o.staff_name ? o.staff_name.slice(0, 40) : null,
      callbackAt: typeof o.callback_time === 'string' && o.callback_time ? o.callback_time.slice(0, 40) : null,
      notes: String(o.notes || '').slice(0, 300) }
  } catch { return null }
}

const FAIL_STATUS: Record<string, string> = { 'no-answer': "nobody picked up", busy: 'the line was busy', failed: "the call didn't connect", canceled: 'the call was cancelled', stopped: 'the call was stopped', error: "the call didn't connect", 'balance-low': 'the calling balance is too low (top up Bolna/Plivo)' }
export const TERMINAL = new Set(['completed', ...Object.keys(FAIL_STATUS)])

/** What the person reads after the call. Pure. */
export function callResultText(p: CallPlan, status: string, outcome: CallOutcome | null, transcriptTail = '', saved = false, reminderScheduled = true) {
  const head = `📞 ${p.venue}`
  // 21 Nov (phone menus): a call again would reach the same keypad menu, so the number is offered instead.
  const menu = /recorded phone menu/i.test(String(outcome?.notes || ''))
  const retry = menu ? `I can't press keypad options, so it is best to call them yourself on ${displayPhone(p.to)}.` : p.redials < MAX_REDIALS ? 'Say *call again* to retry.' : ''
  if (status !== 'completed') return `${head}: ${FAIL_STATUS[status] || "the call didn't complete"}. ${p.kind === 'general' ? 'Nothing was said or agreed.' : 'Nothing was booked.'}${p.test ? '' : p.redials < MAX_REDIALS ? '\nSay *call again* to retry.' : ''}`
  if (p.test) return `${head}: test call finished. Tell me how it sounded, and say *call District 6…* style requests when you're ready.`
  if (!outcome) return `${head}: the call finished, but I couldn't read a clear answer from it, so I'm not treating it as ${p.kind === 'general' ? 'done' : 'booked'}.${transcriptTail ? `\nLast words on the call: "${transcriptTail}"` : ''}`
  if (p.kind === 'general') return outcome.booked
    ? [`*Call done* · ${p.venue}`, outcome.confirmedTime ? `They said: ${outcome.confirmedTime}` : (outcome.notes || 'They dealt with the request.'),
        outcome.staffName ? `Spoke to ${outcome.staffName}.` : '', 'This is what was said on the call, not a written confirmation.'].filter(Boolean).join('\n')
    : [`${head}: no clear answer. ${outcome.notes || 'They did not confirm or answer the request.'}`, outcome.callbackAt ? `They asked to be called back ${outcome.callbackAt}.` : '',
        retry].filter(Boolean).join('\n')
  if (outcome.booked) {
    // 21 Oct live: the notes line repeated the confirmation ("Reservation for 2 … confirmed under Goverdhan").
    return [`*Booked by phone* · ${p.dateLabel.replace(/^on\s+/i, '')}, ${outcome.confirmedTime || p.timeLabel}, ${p.partySize || 2} guests, under ${p.guestName}.`,
      outcome.staffName ? `Confirmed by ${outcome.staffName} on the call.` : 'Confirmed by the restaurant on the call.',
      saved ? (reminderScheduled ? 'Saved to My bookings, with a reminder 2 hours before.' : 'Saved to My bookings. No future 2-hour reminder could be scheduled.') : '',
      'This is a phone confirmation, not a written booking ID.'].filter(Boolean).join('\n')
  }
  return [`${head}: not booked. ${outcome.notes || 'They did not confirm a table.'}`,
    outcome.callbackAt ? `They asked to be called back ${outcome.callbackAt}.` : '',
    retry].filter(Boolean).join('\n')
}

// ---- Bolna I/O -------------------------------------------------------------------------------------------------

async function bolna(path: string, init: { method?: string; body?: any } = {}, fetchImpl: typeof fetch = fetch) {
  const key = String(process.env.BOLNA_API_KEY || '').trim()
  if (!key) throw new Error('bolna_not_configured')
  const res = await fetchImpl(BOLNA + path, {
    method: init.method || 'GET',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  } as any)
  const text = await res.text()
  let data: any = null; try { data = JSON.parse(text) } catch {}
  if (!res.ok) throw Object.assign(new Error(`bolna_${res.status}:${String(data?.message || text).slice(0, 160)}`), { status: res.status })
  return data
}

export const CALL_AGENT_PROMPT = `You are an AI assistant from AskGogo making a short phone call to {venue} on behalf of {guest_name}.
Your task: {purpose}
Details you may share: table for {party_size} people, {date_label} at {time_label}. If that time is full, any time {flex_window} is fine. Seating preference: {seating}. Name for the booking: {guest_name}. Contact number, only if they ask: {contact_number}.
Rules:
- You already said you are an AI assistant and the call may be recorded. If asked again, say so plainly.
- Speak briefly and politely, one question at a time, in simple English (switch to Hindi or Kannada if they do).
- Answer only from the details above. If they ask for anything else (advance, deposit, card, UPI, payment, OTP), say {guest_name} will handle that directly, and do not agree to it.
- If they want to speak to {guest_name} directly or ask you to call later, thank them, ask the best time to call back, and end the call.
- If a recorded phone menu answers instead of a person: if it lets you speak, say the option that fits the task (for example \"reservations\", \"front desk\", \"appointments\") or \"speak to a person\". You cannot press keypad keys. If the menu only accepts key presses, or repeats twice without reaching a person, say thank you and end the call. Never invent an answer from a recorded message. When a person comes on after a menu or hold, first say you are an AI assistant from AskGogo calling for {guest_name} and that the call may be recorded.
- Before ending, repeat the final details back (day, time, people, name) and ask for the staff member's name.
- End politely once the booking is confirmed or refused.`

export const GENERAL_CALL_AGENT_PROMPT = `You are an AI assistant from AskGogo making a short phone call to {venue} on behalf of {guest_name}.
Your task: {purpose}
Start by saying exactly: {opening}
Details you may share if asked: {details}. Name: {guest_name}. You do not have {guest_name}'s phone number; if asked, say they will share it themselves.
Rules:
- You already said you are an AI assistant and the call may be recorded. If asked again, say so plainly.
- Speak briefly and politely, one question at a time, in simple English (switch to Hindi or Kannada if they do).
- Use only the task and details above. Never guess or invent a fact. If they ask for anything you were not given (ID numbers, date of birth, insurance, medical history, address, payment, advance, deposit, card, UPI, OTP), say {guest_name} will share or handle that directly, and do not agree to it.
- If they offer choices (times, dates, room types, prices), accept one only if it matches the task exactly. Otherwise note the choices, say {guest_name} will confirm, and ask how long they can hold it.
- If they want to speak to {guest_name} directly or ask you to call later, thank them, ask the best time to call back, and end the call.
- If a recorded phone menu answers instead of a person: if it lets you speak, say the option that fits the task (for example \"reservations\", \"front desk\", \"appointments\") or \"speak to a person\". You cannot press keypad keys. If the menu only accepts key presses, or repeats twice without reaching a person, say thank you and end the call. Never invent an answer from a recorded message. When a person comes on after a menu or hold, first say you are an AI assistant from AskGogo calling for {guest_name} and that the call may be recorded.
- Before ending, repeat back exactly what was agreed and ask for the person's name.
- End politely once the request is confirmed, refused, or needs {guest_name}.`

/** The Bolna agent definition; the two agents differ only in name and instructions. */
function callAgentBody(name: string, prompt: string) {
  return {
    agent_config: {
      agent_name: name,
      agent_welcome_message: "Hi, I'm an AI assistant from AskGogo, calling on behalf of {guest_name}. This call may be recorded.",
      tasks: [{
        task_type: 'conversation',
        toolchain: { execution: 'sequential', pipelines: [['transcriber', 'llm', 'synthesizer']] },
        tools_config: {
          llm_agent: { agent_type: 'simple_llm_agent', agent_flow_type: 'streaming', llm_config: { provider: 'openai', model: 'gpt-4.1-mini', max_tokens: 150, temperature: 0.2 } },
          synthesizer: { provider: 'elevenlabs', provider_config: { voice: 'Nila', voice_id: 'V9LCAAi4tTlqe9JadbCo', model: 'eleven_turbo_v2_5' }, stream: true, buffer_size: 250, audio_format: 'wav' },
          transcriber: { provider: 'deepgram', model: 'nova-3', language: 'en', stream: true, encoding: 'linear16', sampling_rate: 16000, endpointing: 250 },
          input: { provider: 'plivo', format: 'wav' },
          output: { provider: 'plivo', format: 'wav' },
        },
        task_config: { call_terminate: 180, hangup_after_silence: 12 },
      }],
    },
    agent_prompts: { task_1: { system_prompt: prompt } },
  }
}

let cachedAgentId: string | null = null
let cachedGeneralAgentId: string | null = null
/** Find the AskGogo caller agent by name, or create it once. */
export async function ensureCallAgent(fetchImpl: typeof fetch = fetch, kind: 'table' | 'general' = 'table'): Promise<string> {
  if (kind === 'general') {
    if (cachedGeneralAgentId) return cachedGeneralAgentId
    if (process.env.BOLNA_GENERAL_AGENT_ID) return (cachedGeneralAgentId = process.env.BOLNA_GENERAL_AGENT_ID)
    const every = await bolna('/v2/agent/all', {}, fetchImpl)
    const had = (Array.isArray(every) ? every : []).find((a: any) => a?.agent_name === GENERAL_CALL_AGENT_NAME && a?.id)
    if (had) return (cachedGeneralAgentId = String(had.id))
    const made = await bolna('/v2/agent', { method: 'POST', body: callAgentBody(GENERAL_CALL_AGENT_NAME, GENERAL_CALL_AGENT_PROMPT) }, fetchImpl)
    const gid = String(made?.agent_id || '')
    if (!gid) throw new Error('bolna_agent_create_failed')
    return (cachedGeneralAgentId = gid)
  }
  if (cachedAgentId) return cachedAgentId
  if (process.env.BOLNA_AGENT_ID) return (cachedAgentId = process.env.BOLNA_AGENT_ID)
  const all = await bolna('/v2/agent/all', {}, fetchImpl)
  const found = (Array.isArray(all) ? all : []).find((a: any) => a?.agent_name === CALL_AGENT_NAME && a?.id)
  if (found) return (cachedAgentId = String(found.id))
  const created = await bolna('/v2/agent', { method: 'POST', body: callAgentBody(CALL_AGENT_NAME, CALL_AGENT_PROMPT) }, fetchImpl)
  const id = String(created?.agent_id || '')
  if (!id) throw new Error('bolna_agent_create_failed')
  return (cachedAgentId = id)
}

export async function placeCall(plan: CallPlan, contactNumber: string, fetchImpl: typeof fetch = fetch, owner?: string) {
  let agentId: string
  if (plan.callLanguage !== undefined || plan.voiceAgentId !== undefined) {
    const { sarvamCallProfile } = await import('./voice-call-language')
    const profile = sarvamCallProfile(owner,plan.callLanguage,plan.kind ?? 'table')
    if (!profile || profile !== plan.voiceAgentId) throw Error('localized_call_profile_unavailable')
    agentId = profile
  } else {
    agentId = await ensureCallAgent(fetchImpl, plan.kind === 'general' ? 'general' : 'table')
  }
  const res = await bolna('/call', { method: 'POST', body: {
    agent_id: agentId,
    recipient_phone_number: plan.to,
    from_phone_number: String(process.env.BOLNA_FROM_NUMBER || DEFAULT_FROM_NUMBER),
    // A general call is given only what is on its approved card; no table fields.
    user_data: plan.kind === 'general'
      ? { venue: plan.venue, guest_name: plan.guestName, purpose: plan.purpose, opening: plan.opening || '', details: plan.details || 'only what is in the task', timezone: 'Asia/Kolkata' }
      : {
      venue: plan.venue, guest_name: plan.guestName, party_size: String(plan.partySize || 2), date_label: plan.dateLabel,
      time_label: plan.timeLabel, flex_window: plan.flexWindow, seating: plan.seating,
      contact_number: plan.callLanguage ? '' : contactNumber, purpose: plan.purpose, timezone: 'Asia/Kolkata',
    },
  } }, fetchImpl)
  const executionId = String(res?.execution_id || '')
  if (!executionId) throw new Error('bolna_call_no_execution')
  return executionId
}

export async function getExecution(executionId: string, fetchImpl: typeof fetch = fetch) {
  return bolna(`/executions/${encodeURIComponent(executionId)}`, {}, fetchImpl)
}

// ---- chat entry ------------------------------------------------------------------------------------------------

type Actor = { userId: string; legacyTelegramId: number; whatsappId: string; name: string }
type Reply = { text: string; handledBy: string }

const BOOKING_NAME = 'BOOKING_NAME:'

/** The booking name the user last gave ("under the name Goverdhan"). */
export async function savedBookingName(telegramId: number): Promise<string | null> {
  const { data } = await supabaseAdmin.from('memories').select('content').eq('telegram_id', telegramId).like('content', `${BOOKING_NAME}%`).order('id', { ascending: false }).limit(1)
  const v = String(data?.[0]?.content || '').slice(BOOKING_NAME.length).trim()
  return v && /^[A-Za-z][A-Za-z .'-]{1,60}$/.test(v) ? v : null
}

async function rememberBookingName(telegramId: number, name: string) {
  const clean = String(name || '').trim()
  if (!/^[A-Za-z][A-Za-z .'-]{1,60}$/.test(clean) || /^(?:gogo|askgogo|me|myself)$/i.test(clean)) return
  if ((await savedBookingName(telegramId))?.toLowerCase() === clean.toLowerCase()) return
  await supabaseAdmin.from('memories').insert({ telegram_id: telegramId, content: `${BOOKING_NAME}${clean}` })
}

async function latestAssistantText(telegramId: number) {
  const { data } = await supabaseAdmin.from('conversations').select('role,content').eq('telegram_id', telegramId).order('created_at', { ascending: false }).limit(3)
  return String((data || []).find((r: any) => r.role === 'assistant')?.content || '')
}

/** The best venue number from search results: trusted listings first, then any page naming the venue. Pure. */
export function pickVenuePhone(results: Array<{ url?: string; title?: string; snippet?: string }>, venue: string) {
  const trusted = /(?:^|\.)(?:zomato\.com|justdial\.com|swiggy\.com|district\.in|eazydiner\.com|magicpin\.in|google\.com|tripadvisor\.in|tripadvisor\.com)$/i
  const name = String(venue || '').toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const hits: Array<{ phone: string; host: string; score: number }> = []
  for (const r of results || []) {
    const text = `${r.title || ''} ${r.snippet || ''}`
    const phone = indianPhoneFrom(text)
    if (!phone) continue
    let host = ''; try { host = new URL(String(r.url)).hostname.replace(/^www\./, '') } catch {}
    const named = name.length && name.every(w => text.toLowerCase().includes(w))
    hits.push({ phone, host, score: (trusted.test(host) ? 2 : 0) + (named ? 1 : 0) })
  }
  hits.sort((a, b) => b.score - a.score)
  const best = hits[0]
  return best ? { phone: best.phone, source: best.host ? `from ${best.host}` : 'from a web listing' } : null
}

async function findVenuePhone(venue: string, area: string) {
  // 21 Oct live: the same request found the Zomato number at 12:26 and nothing at 13:00 (results vary per search).
  const { searchWebResults } = await import('@/lib/web-search')
  const place = area || 'Bangalore'
  const queries = [`${venue} ${place} phone number`, `${venue} ${place} contact number reservations`, `${venue} Bangalore zomato`]
  const batches = await Promise.all(queries.map(q => searchWebResults(q).catch(() => [] as any[])))
  return pickVenuePhone(batches.flat(), venue)
}

/** The booking name said in a call request. Pure.
 *  17 Nov live (investor demo): "…at 9pm on Saturday under name Manu jain" and "…under name Divya" were both booked
 *  under "Gogo", because only "under the name X" and "under X" (capitalised) were read.
 *  Review (PR #1533): this name is spoken on a real call, so the reader is strict. It looks only at the request part
 *  (after "and book"/"to reserve"), takes at most three name words, and stops at the first word that is a day, a
 *  time word or ordinary sentence filler. Anything doubtful gives null, and the plan card shows the name used. */
const NAME_STOP = new Set(('mon monday tue tues tuesday wed wednesday thu thur thurs thursday fri friday sat saturday sun sunday today tomorrow tmrw tonight ' +
  'next this for at on and please pls plz thanks thank thx in near with also not or from by around after before ask a an the my our his her their your is as will be ' +
  'given later usual decided table tables people guests pax pm am just it of name names company list tags etc morning afternoon evening night lunch dinner brunch breakfast').split(' '))
const NAME_TRIGGER = /(?:\bunder\s+(?:the\s+)?names?(?:\s+of)?|\bin\s+the\s+name\s+of|(?<!\b(?:restaurant|venue|place|hotel|cafe|bar|pub|whose|its)(?:'s)?\s+)(?<!\bthe\s+)\b(?:booking\s+)?name\s+is|\bthe\s+(?:booking\s+)?name\s+is)[:"'“”‘’\s-]+/gi
const TITLE = /^(?:dr|mr|mrs|ms|prof)\.?$/i
function nameSpan(text: string): { name: string; start: number; end: number } | null {
  const t = String(text || '')
  const from = t.search(new RegExp(`\\b(?:and|to)\\s+(?:${CALL_ASK_VERBS})\\b`, 'i'))
  if (from < 0) return null
  const read = (start: number, at: number, capitalOnly: boolean) => {
    const words: string[] = []
    let pos = at
    const re = /\s*["'“”‘’]?([A-Za-z][A-Za-z.'’]*)["'“”‘’]?/y
    while (words.length < 3) {
      re.lastIndex = pos
      const m = re.exec(t)
      if (!m) break
      const w = m[1]
      if (NAME_STOP.has(w.toLowerCase().replace(/[.'’]+$/, ''))) break
      if (capitalOnly && !/^[A-Z]/.test(w)) break
      words.push(w); pos = re.lastIndex
    }
    while (words.length && !TITLE.test(words[words.length - 1]) && /[.'’]$/.test(words[words.length - 1]) && words[words.length - 1].replace(/[.'’]+$/, '').length > 1) words[words.length - 1] = words[words.length - 1].replace(/[.'’]+$/, '')
    if (!words.length || words.every(w => TITLE.test(w) || w.replace(/\./g, '').length <= 1)) return null
    const name = words.map(w => w.length <= 2 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    return { name, start, end: pos }
  }
  NAME_TRIGGER.lastIndex = from
  for (let m = NAME_TRIGGER.exec(t); m; m = NAME_TRIGGER.exec(t)) { const got = read(m.index, m.index + m[0].length, false); if (got) return got }
  const u = /\bunder\s+(?=[A-Z])/g; u.lastIndex = from
  for (let m = u.exec(t); m; m = u.exec(t)) { const got = read(m.index, m.index + m[0].length, true); if (got) return got }
  return null
}
export function callBookingName(text: string): string | null { return nameSpan(callLanguageRequest(text)?.request ?? text)?.name ?? null }
/** Pure. Removes only the "under (the) name X" words, so the day, time and venue around them are still read. */
export function stripCallBookingName(text: string): string {
  const s = nameSpan(text)
  const t = String(text || '')
  return s ? (t.slice(0, s.start).replace(/[\s,]+$/, '') + ' ' + t.slice(s.end).replace(/^[\s,.!]+/, '')).trim() : t.trim()
}
/** Pure. A call request to book a hotel room or a stay, which the calling agent cannot do (it books tables).
 *  A private or party room at a restaurant is a table booking, not this. */
export function isRoomCallRequest(text: string): boolean {
  const t = String(text || '')
  const req = t.slice(Math.max(0, t.search(/\b(?:and|to)\s+(?:book|reserve)\b/i)))
  if (/\b(?:private|dining|party|function|banquet|meeting|conference|upstairs|back)\s+(?:dining\s+)?rooms?\b/i.test(req)) return false
  if (/\b(?:book|reserve)\s+(?:me\s+|us\s+)?(?:a|an|the|one|two|three|\d+)?\s*(?:[a-z-]+\s+){0,3}(?:rooms?|suites?|villa|cottage|accommodation|stay)\b/i.test(req) && !/\btables?\b/i.test(req)) return true
  return /\bfor\s+(?:\d+|one|two|three|four|five|six|seven)\s+nights?\b/i.test(req) && !/\btables?\b/i.test(req)
}

/** Pure. Does a typed name refer to a venue from an earlier call? "Toit" matches "Toit" and "Toit Indiranagar"
 *  (the typed words are the start of the saved name); "Toit Koramangala" does not match "Toit Indiranagar". */
export function sameVenue(typed: string, saved: string): boolean {
  const norm = (x: string) => String(x || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const a = norm(typed), b = norm(saved)
  if (a.length < 3 || !b) return false
  return a === b || b.startsWith(a + ' ')
}

/** 21 Nov (handoff calling gap): "call Toit and ask if they're open Sunday" has no business word, so the parser cannot
 *  tell Toit from a person ("call Divya and ask…") and treats it as a note to self. A venue this person already called
 *  through an approved call plan is known: its name and the number shown on that plan are reused. Owner-bound read of
 *  the person's own call runs; test calls never count. */
export async function knownCallVenue(owner: string, typed: string, db: { from: (t: string) => any } = supabaseAdmin): Promise<{ venue: string; phone: string; source: string } | null> {
  const name = String(typed || '').trim()
  // Review (PR #1561): WhatsApp-created owners are negative ids (lib/dashboard/owner-identity.ts); same check as
  // beginApprovedVoiceCall.
  const o = String(owner || '')
  if (!/^-?\d{1,16}$/.test(o) || !Number.isSafeInteger(Number(o)) || name.length < 3 || name.length > 60 || PERSONAL_CALLEE.test(name) || genericCallee(name)) return null
  try {
    // A friend of that name is a person, never the venue ("call Hari and ask…" with Hari Super Sandwich called before).
    const friends = await db.from('friend_contacts').select('name').eq('owner_telegram_id', o).limit(200)
    if (friends?.error) return null
    const low = name.toLowerCase()
    if ((friends?.data || []).some((f: any) => { const n = String(f?.name || '').trim().toLowerCase(); return n && (n === low || n.split(/\s+/)[0] === low) })) return null
    const { data, error } = await db.from('agent_runs').select('metadata_json,started_at,status').eq('telegram_id', o).eq('type', 'voice_call').order('started_at', { ascending: false }).limit(40)
    if (error || !Array.isArray(data)) return null
    for (const row of data) {
      const plan = row?.metadata_json?.plan
      if (!plan || plan.test || typeof plan.venue !== 'string' || !/^\+91\d{10}$/.test(String(plan.to || ''))) continue
      // Review (PR #1561): only a number the person typed themselves is reused. A table plan's number can come from a
      // web lookup, which the general-call rule above refuses; a call the provider rejected never vouches for a number.
      if (!/^the number you gave\b/.test(String(plan.source || '')) || row?.status === 'failed') continue
      if (sameVenue(name, plan.venue)) return { venue: plan.venue, phone: String(plan.to), source: `the number you gave for ${plan.venue} earlier` }
    }
  } catch {}
  return null
}

/** The typed callee of a "call X and/to <ask>" message, when the parser alone did not take it. Null otherwise. Pure. */
export function unknownCallee(text: string): string | null {
  const ask = callLead(text).match(CALL_ASK)
  if (!ask || parseCallCommand(text)) return null
  const callee = calleeParts(ask[1])
  if (callee.phone || callee.unreadable || TIMEY_CALLEE.test(ask[1]) || PERSONAL_CALLEE.test(callee.name)) return null
  // "…and ask if he is coming", "…and tell her I'm late": a person, not a business.
  if (/\b(?:he|she|him|her|his|hers)\b/i.test(callLead(text).slice(ask[0].length))) return null
  return callee.name || null
}


/** Only a stand-alone, fully readable Indian number may complete a pending general-call request. */
export function callNumberReply(raw: string): string | null {
  const s = String(raw || '').trim()
  if (!/^\+?[\d\s().-]{9,24}$/.test(s)) return null
  const d = s.replace(/\D/g,'')
  if (!(d.length === 10 || (d.length === 11 && d.startsWith('0')) || (d.length === 12 && d.startsWith('91')))) return null
  return indianPhoneFrom(s)
}

/** Convert a fresh, owner-bound number-only reply into a *new request*, not permission to dial.
 * The original ask must be a general business call. The prompt must still be the user's latest
 * assistant message and must have been written within ten minutes. No web number is accepted.
 */
export function generalCallFromNumberReply(state: any, replyText: string, lastAssistant: string, owner: string, now = Date.now()): string | null {
  const phone = callNumberReply(replyText)
  const p = state?.payload
  const at = Date.parse(String(state?.created_at || ''))
  const age = now-at
  if (!phone || state?.type !== 'followup_state' || state?.kind !== CALL_NUMBER_STATE || !p ||
      String(p.owner || '') !== owner || !Number.isFinite(at) || age < -60_000 || age > 10*60_000 ||
      !p.prompt || p.prompt !== lastAssistant || typeof p.original !== 'string' || p.original.length > 450) return null
  const original = callLead(p.original)
  if (parseCallCommand(original)?.kind !== 'book') return null
  const languageRequest = callLanguageRequest(original)
  const task = languageRequest?.request ?? original
  const pieces = splitCallAsk(stripCallBookingName(task))
  if (!pieces || pieces.phone || pieces.unreadable || !pieces.venue || PERSONAL_CALLEE.test(pieces.venue) ||
      isTableAsk(pieces.ask) || pieces.ask.length > 250) return null
  const named = callBookingName(task)
  const next = 'call '+pieces.venue+' on '+phone+' and '+pieces.ask+(named ? ' under the name '+named : '')+(languageRequest?.directive ?? '')
  return parseCallCommand(next)?.kind === 'book' ? next : null
}

/** Keep string owner IDs exact; never convert the key to JS Number for a privileged lookup. */
export async function confirmedGeneralCallNumberRequest(owner: string, text: string, db: {from:(t:string)=>any} = supabaseAdmin): Promise<string | null> {
  if (!/^-?[1-9]\d{0,18}$/.test(String(owner)) || !callNumberReply(text)) return null
  try {
    const {data, error}=await db.from('memories').select('content,created_at').eq('telegram_id',owner).order('created_at',{ascending:false}).limit(25)
    if (error) return null
    const state=(data||[]).map((r:any)=>{try{return JSON.parse(String(r.content||''))}catch{return null}})
      .find((x:any)=>x?.type==='followup_state'&&x?.kind===CALL_NUMBER_STATE)
    if (!state) return null
    const last=await db.from('conversations').select('role,content').eq('telegram_id',owner)
      .order('created_at',{ascending:false}).order('role',{ascending:true}).limit(1)
    if (last.error || last.data?.[0]?.role !== 'assistant') return null
    return generalCallFromNumberReply(state,text,String(last.data[0].content||''),owner)
  } catch { return null }
}
export async function isGeneralCallNumberReply(owner: string, text: string): Promise<boolean> {
  return Boolean(await confirmedGeneralCallNumberRequest(owner,text))
}

/** For the routes: is this a call request, counting a venue this person has called before? */
export async function isCallRequestFor(owner: string, text: string): Promise<boolean> {
  if (parseCallCommand(text)?.kind === 'book') return true
  const name = unknownCallee(text)
  return !!name && !!(await knownCallVenue(owner, name))
}

/** Pure. "Call <who> [on <number>] and <ask>" → who, the number said with it, and the ask. */
export function splitCallAsk(text: string): { venue: string; phone: string | null; unreadable: boolean; ask: string } | null {
  const m = String(text || '').trim().match(new RegExp(`^(?:please\\s+)?(?:call|phone|ring)\\s+(?:up\\s+)?(.{2,80}?)\\s+(?:and|to)\\s+((?:${CALL_ASK_VERBS})\\b.+)$`, 'i'))
  if (!m) return null
  const callee = calleeParts(m[1])
  const ask = m[2].replace(/[{}]/g, ' ').replace(/\s+/g, ' ').replace(/[.!\s]+$/, '').trim()
  const venue = callee.name || (callee.phone || callee.unreadable ? 'the number you gave' : '')
  return venue && ask ? { venue, phone: callee.phone, unreadable: callee.unreadable, ask } : null
}
/** Pure. A restaurant table booking (the existing flow). Everything else is a general call.
 *  Review: decided by WHAT is being booked, not by any word in the sentence ("…it is my doctor friend's birthday"). */
const NON_TABLE_THING = 'rooms?|suites?|villa|cottage|accommodation|stay|appointments?|slots?|ambulance|treatment|session|cab|taxi|tickets?|consultation|check-?up|tests?|scan|x-?ray|mri|service|servicing|haircut|facial|massage|pedicure|manicure|cake|cylinder|court|turf|hall|venue|bed|vaccination|vaccine|visit|demo|test\\s+drive|class|delivery|pick-?up|membership|order'
export function isTableAsk(ask: string): boolean {
  const a = String(ask || '')
  if (!/^(?:book|reserve)\b/i.test(a)) return false
  // Second review: the default is a general call. A table needs a table word, a meal, or a party size; a room for
  // nights, an appointment or a test never gets the table script just because nothing else matched.
  if (/\bfor\s+(?:\d+|one|two|three|four|five|six|seven)\s+nights?\b|\b\d+\s+nights?\b/i.test(a)) return false
  if (new RegExp(`^(?:book|reserve)\\s+(?:me\\s+|us\\s+)?(?:a|an|the|my|our|one|two|three|\\d+)?\\s*(?:[a-z-]+\\s+){0,3}(?:${NON_TABLE_THING})\\b`, 'i').test(a) && !/^(?:book|reserve)\s+(?:a\s+|the\s+)?(?:private|dining|party)\s+(?:dining\s+)?room\b/i.test(a)) return false
  if (/\btable\s+tennis\b/i.test(a)) return false
  return /\btables?\b|\b(?:seats?|people|persons?|pax|guests?|dinner|lunch|brunch|breakfast)\b|\b(?:private|dining|party)\s+(?:dining\s+)?room\b|\bfor\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b(?!\s*(?:nights?|days?|hours?|hrs?|am|pm|[:.]\d))/i.test(a)
}
export type CallBrief = { task: string; opening: string; details: string }
const speakFor = (s: string, name: string) => s.replace(/\bI\s+am\b/gi, 'they are').replace(/\bI'?m\b/gi, 'they are').replace(/\bI\s+was\b/gi, 'they were').replace(/\bI\s+will\b/gi, 'they will').replace(/\bI'?ll\b/gi, 'they will').replace(/\bI\s+have\b/gi, 'they have')
  .replace(/\bI\b/g, 'they').replace(/\bmy\b/gi, 'their').replace(/\bour\b/gi, 'their').replace(/\b(?:me|us)\b/gi, name).replace(/\bwe\b/gi, 'they')
/** Pure. The plan when no model is available or its answer is not trusted: the person's own words, nothing added.
 *  Spoken by the caller, so "my/our/I" become the person, and "tell them …" is passed on as a message, word for word. */
export function fallbackCallBrief(ask: string, guestName = 'my client'): CallBrief {
  const a = String(ask || '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '')
  const WHO = "(them|him|her|(?:Dr\\.?\\s+)?[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)"
  const msg = a.match(new RegExp(`^(?:tell|inform)\\s+${WHO}\\s+(?:that\\s+)?(.{3,})$`)) || a.match(new RegExp(`^let\\s+${WHO}\\s+know\\s+(?:that\\s+)?(.{3,})$`))
  if (msg) {
    const to = /^(?:them|him|her)$/.test(msg[1]) ? '' : ` for ${msg[1]}`
    return { task: `Pass on this message from ${guestName}${to}: "${msg[2].trim()}".`, opening: `I have a message from ${guestName}${to}: ${msg[2].trim()}.`, details: 'only what is in the request' }
  }
  const lower = a.charAt(0).toLowerCase() + a.slice(1)
  return { task: `For ${guestName}: ${speakFor(lower, guestName)}.`, opening: `I'm calling for ${guestName} to ${speakFor(lower, guestName)}.`, details: 'only what is in the request' }
}
const BRIEF_ALLOW = new Set(("i i'm im i'd id calling call caller to like would please for on at the a an with is if about of and in from by be can could it this that name under check whether have has do does there any available availability possible request " +
  'behalf their they them message are will regarding ask asking know confirm').split(' '))
const stem = (w: string) => { const s = w.toLowerCase().replace(/[’']s$/, '').replace(/[^a-z0-9]/g, ''); return s.length > 4 ? s.replace(/(?:ing|ed|es|s)$/, '') : s }
const briefWords = (s: string) => (String(s || '').toLowerCase().replace(/(\d)\s+(am|pm)\b/g, '$1$2').match(/[a-z0-9][a-z0-9’']*/g) || [])
const CRITICAL = /^(?:\d[\da-z:.]*|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|not|no|never|without|with|cannot|only|before|after|from|to|by|until|cancel|reschedule|[a-z]+n[’']t|one|two|three|four|five|six|seven|eight|nine|ten|if|whether)$/
/** Pure. A model-written brief is used only when it is a faithful restatement of the ask (review, PR #1534):
 *  every word comes from the ask, the callee or the person's name (plus a few plain connecting words); every number,
 *  time, day and "not/cancel" in the ask is still there; the task starts with the ask's own verb; the opening is in
 *  the caller's voice. Anything else is refused and the person's own words are used. */
export function acceptCallBrief(raw: string, ask: string, venue = '', guestName = ''): CallBrief | null {
  const m = String(raw || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  let o: any; try { o = JSON.parse(m[0]) } catch { return null }
  const clean = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\r\n*_`"{}]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
  const task = clean(o.task, 240), opening = clean(o.opening, 200)
  const details = Array.isArray(o.details) ? o.details.map((d: unknown) => clean(d, 80)).filter(Boolean).slice(0, 6).join('; ') : clean(o.details, 300)
  if (task.length < 8 || opening.length < 8) return null
  if (!/^(?:i'm calling (?:for .{1,40} )?to|i'd like to|i have a message from)\b/i.test(opening)) return null
  const allowed = new Set([...briefWords(ask), ...briefWords(venue), ...briefWords(guestName)].map(stem))
  for (const w of briefWords(`${task} ${opening} ${details}`)) { const s = stem(w); if (s && !allowed.has(s) && !BRIEF_ALLOW.has(w) && !BRIEF_ALLOW.has(s)) return null }
  // Second review: numbers, times, days, negations and "from/to/with/without/if" must appear in the same order and
  // the same number of times in the task and in the opening as in the ask, so nothing can be swapped, doubled or
  // flipped ("can't" → "can", "2 rooms for 3 nights" → "3 rooms for 2 nights", "from Friday to Monday" reversed).
  const crit = (s: string) => briefWords(s).filter(w => CRITICAL.test(w)).join(' ')
  const askWords = briefWords(ask), verb = stem(askWords[0] || '')
  const said = (s: string) => { const w = briefWords(s); const at = w.findIndex(x => stem(x) === verb); return at < 0 ? null : w.slice(at).filter(x => CRITICAL.test(x)).join(' ') }
  if (said(task) !== crit(ask) || said(opening) !== crit(ask)) return null
  if (stem(briefWords(task)[0] || '') !== verb) return null
  return { task: /[.?!]$/.test(task) ? task : task + '.', opening: /[.?!]$/.test(opening) ? opening : opening + '.', details: details || 'only what is in the request' }
}
/** Turns the person's ask into what the caller says and may share. The model may only restate what was asked. */
export async function compileCallAsk(ask: string, venue: string, guestName = 'my client', model?: (prompt: string) => Promise<string>): Promise<CallBrief> {
  const prompt = `Someone (${guestName}) asked their assistant to phone "${venue}" and do this: "${ask}".\nRestate it as what the assistant should do on the call. Reply with JSON only:\n{"task": one sentence that starts with the same verb as the request, "opening": one spoken sentence starting with "I'm calling for ${guestName} to" or "I'd like to", "details": [short facts copied from the request: dates, times, counts, names, doctor or department, room type]}\nRules: use ONLY words and facts from the request. Do not add or change any date, time, price, number, name, symptom, reason or adjective. Keep day words and times exactly as written. No payment, card, fee or ID talk.`
  try {
    const run = model || (async (q: string) => {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const res: any = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({ model: 'claude-haiku-4-5', max_tokens: 300, messages: [{ role: 'user', content: q }] })
      return String(res?.content?.[0]?.text || '')
    })
    return acceptCallBrief(await run(prompt), ask, venue, guestName) || fallbackCallBrief(ask, guestName)
  } catch { return fallbackCallBrief(ask, guestName) }
}

export async function tryVoiceCall(params: { actor: Actor; text: string; surface: 'web' | 'whatsapp' }): Promise<Reply | null> {
  const tg = params.actor.legacyTelegramId
  let cmd = parseCallCommand(params.text)
  const numberFollowup = !cmd ? await confirmedGeneralCallNumberRequest(String(tg),params.text) : null
  if (numberFollowup) cmd = { kind: 'book', text: numberFollowup }
  if (!cmd) {
    // A venue called before ("call Toit and ask…"): the same flow as a named business, with that call's number.
    const name = unknownCallee(params.text)
    if (!name || !(await knownCallVenue(String(tg), name))) return null
    if (!splitCallAsk(stripCallBookingName(callLead(params.text)))) return null
    cmd = { kind: 'book', text: callLead(params.text) }
  }
  const fs = await import('@/lib/bot/handlers/followup-state')
  if (cmd.kind === 'affirm') {
    // 21 Oct live: "Yes" to the plan fell through to chat, which claimed it was calling. A bare yes right
    // after the plan is the approval; anywhere else it belongs to some other question.
    if (!(await latestAssistantText(tg)).includes('CALL PLAN')) return null
  }
  // Launch kill switch (GOGO_VOICE_CALLS=off): no plan is made and no call is placed, including a yes to a plan
  // shown before the switch was flipped. "No" still clears the plan.
  if (cmd.kind !== 'decline' && capabilityPaused('voice_calls')) return { text: capabilityPausedText('voice_calls'), handledBy: 'voice-call' }
  if (cmd.kind === 'approve' || cmd.kind === 'affirm' || cmd.kind === 'redial' || cmd.kind === 'decline') {
    const state: any = await fs.getLatestFollowupState(tg, PLAN_STATE)
    const plan: CallPlan | undefined = state?.payload?.plan
    if (!plan) return cmd.kind === 'approve' || cmd.kind === 'affirm' || cmd.kind === 'redial' ? { text: "There's no call waiting for your yes. Ask me to call a restaurant first, like *call District 6 and book a table for 2 Saturday 8pm*.", handledBy: 'voice-call' } : null
    if (cmd.kind === 'decline') {
      // A bare "no" only declines the call plan Gogo just showed; otherwise it belongs to another question.
      if (!(await latestAssistantText(tg)).includes('CALL PLAN')) return null
      await fs.clearFollowupState(tg, PLAN_STATE); return { text: 'OK, I won\'t call.', handledBy: 'voice-call' }
    }
    if (cmd.kind === 'approve' || cmd.kind === 'affirm') {
      // The yes must answer the plan just shown (within 15 min, and Gogo's latest message is the plan).
      const fresh = Date.now() - Date.parse(String(plan.createdAt)) < 15 * 60_000
      if (!fresh || !(await latestAssistantText(tg)).includes('CALL PLAN')) return { text: 'That call plan has expired. Ask me again and I\'ll show a fresh plan before calling.', handledBy: 'voice-call' }
    } else {
      if (plan.redials >= MAX_REDIALS) return { text: `I've already called ${plan.venue} ${plan.redials + 1} times, so I'll stop there. You can book on an app or call them yourself: ${displayPhone(plan.to)}.`, handledBy: 'voice-call' }
      plan.redials += 1
    }
    // Handoff (21 Nov): nothing stopped a call at 11 pm. Outside calling hours the approved call is not placed.
    const hours = callingHoursProblem(plan.to, new Date())
    if (hours) return { text: hours, handledBy: 'voice-call' }
    if (!voiceCallsEnabled()) return { text: 'Calling isn\'t switched on yet (the voice provider key is missing). Nothing was called.', handledBy: 'voice-call' }
    if (plan.callLanguage !== undefined || plan.voiceAgentId !== undefined) {
      const { sarvamCallProfile } = await import('./voice-call-language')
      const profile = sarvamCallProfile(tg,plan.callLanguage,plan.kind ?? 'table')
      if (!profile || profile !== plan.voiceAgentId) return { text:'The voice profile for that plan is unavailable or has changed. Ask for a fresh plan. Nothing was called.',handledBy:'voice-call' }
    }
    const contact = params.actor.whatsappId ? '+' + String(params.actor.whatsappId).replace(/\D/g, '') : ''
    const placement = await beginApprovedVoiceCall({ owner: String(tg), plan,
      approvedPlanHash: String(state?.payload?.approvalHash || ''),
      shownText: await latestAssistantText(tg), expectedText: callPlanText(plan), surface: params.surface,
      db: supabaseAdmin, place: () => placeCall(plan, contact, fetch, String(tg)) })
    if (placement.status === 'outcome_unknown') return { text: `The call to ${plan.venue} may have started, but I couldn't confirm its status. I haven't repeated it. Check the task before trying again.`, handledBy: 'voice-call' }
    if (placement.status === 'rejected') return { text: `The calling provider rejected this attempt to ${plan.venue}. Nothing was called or booked. Ask for a fresh call plan to try again.`, handledBy: 'voice-call' }
    if (placement.status === 'blocked') return { text: placement.reason === 'call_already_attempted' || placement.reason === 'previous_call_requires_reconciliation'
      ? `That call has already been attempted or still needs its outcome checked. I won't call again until that is resolved.`
      : `I couldn't safely start that call. Ask for a fresh call plan and approve the exact details again. Nothing new was called.`, handledBy: 'voice-call' }
    await fs.saveFollowupState(tg, PLAN_STATE, { plan, approvalHash: state.payload.approvalHash }).catch(() => {})
    return { text: `📞 Calling ${plan.venue} now from ${displayPhone(String(process.env.BOLNA_FROM_NUMBER || DEFAULT_FROM_NUMBER))}. I'll message you here with what they said, usually within 2–3 minutes.`, handledBy: 'voice-call' }
  }

  // 21 Nov live: at 9:05 pm a full call plan was shown and refused only after the yes. Every call that can be placed
  // is to an Indian number (beginApprovedVoiceCall requires +91), so outside calling hours no plan is made at all:
  // no number lookup, no brief written, nothing saved. The check at approval time stays as the backstop.
  const closed = callingHoursProblem('+910000000000', new Date())
  if (closed) return { text: closed, handledBy: 'voice-call' }
  const languageRequest = callLanguageRequest(numberFollowup || params.text)
  let voiceProfile: Pick<CallPlan,'callLanguage'|'voiceAgentId'> = {}
  if (languageRequest) {
    const language = languageRequest.language
    if (cmd.kind === 'book') cmd = { ...cmd, text:callLead(languageRequest.request) }
    if (language !== 'english') {
      const callLanguage = language === 'hindi' ? 'Hindi' : language === 'kannada' ? 'Kannada' : null
      const ask = cmd.kind === 'book' ? splitCallAsk(stripCallBookingName(cmd.text)) : null
      const { sarvamCallProfile } = await import('./voice-call-language')
      const profile = sarvamCallProfile(tg,callLanguage,ask && !isTableAsk(ask.ask) ? 'general' : 'table')
      if (!callLanguage || !profile) return {text:'That call language is unavailable for this account. Nothing was called.',handledBy:'voice-call'}
      voiceProfile = {callLanguage,voiceAgentId:profile}
    }
  }
  // "…under the name Goverdhan" wins; otherwise the account name.
  // A phone-only reply must preserve the explicit name in the original, owner-bound task.
  const givenName = callBookingName(numberFollowup || params.text)
  const named = givenName ? [givenName, givenName] : null
  // 29 Oct live: both demo bookings were made "under Gogo" (the account name, which a restaurant hears as AskGogo).
  // A name the user gave once ("under the name Goverdhan") is remembered and used for later calls.
  const savedName = named?.[1] ? null : await savedBookingName(tg).catch(() => null)
  const guestName = named?.[1] || savedName || String(params.actor.name || 'my client').split(/\s+/)[0]
  const now = new Date().toISOString()
  let plan: CallPlan
  if (cmd.kind === 'test') {
    const own = cmd.number || indianPhoneFrom(String(params.actor.whatsappId || ''))
    if (!own) return { text: "I don't have an Indian mobile number for you to test-call.", handledBy: 'voice-call' }
    plan = { ...voiceProfile, venue: 'your phone', to: own, source: cmd.number ? 'the number you gave' : 'your WhatsApp number', guestName, partySize: null, date: null, dateLabel: 'today', timeLabel: 'now', flexWindow: 'n/a', seating: 'n/a',
      purpose: 'This is a short test call. Say hello, explain you are testing how you sound for future restaurant bookings, ask if the audio is clear, then thank them and end.', test: true, redials: 0, createdAt: now }
  } else {
    const rr = await import('@/lib/agent/restaurant-reservation')
    // "Call District 6 near Orion mall and book a table for 2 Saturday 8pm" -> "Book a table for 2 Saturday 8pm at District 6 near Orion mall"
    // 17 Nov (owner): "calling should work on everything, whether it's a table, a hotel room or my hospital
    // appointment; the script should work accordingly". A restaurant table keeps the flow below. Anything else gets a
    // plan written from the ask itself, and the same explicit yes before any call.
    const general = splitCallAsk(stripCallBookingName(cmd.text))
    if (general && !isTableAsk(general.ask)) {
      // Who is called: only the number the person gave with the name. Two independent reviews showed a web lookup can
      // put a different business's number (or a fake helpline) on the card, and this call may carry health or travel
      // details. Until there is a source that can be trusted for this, no number is looked up for a general call.
      const callee = general.venue
      if (general.unreadable) return { text: `I couldn't read the phone number in that message, so I haven't planned a call. Send one 10-digit mobile number or a landline with its STD code, like *call ${callee} on 080 1234 5678 and ${general.ask}*.`, handledBy: 'voice-call' }
      const known = general.phone ? null : await knownCallVenue(String(tg), callee)
      if (known) { general.phone = known.phone; general.venue = known.venue }
      if (!general.phone) {
        const showPicker=process.env.GOGO_GENERAL_CALL_PLACES_LOOKUP==='1' &&
          (await import('./general-call-places-phone')).generalCallPickerEnabled(tg)
        const pickerHint=showPicker?' You can check a business listing at https://app.askgogo.in/dashboard/call-number, then reply here with the number you confirm.':''
        const prompt=`To call ${callee}, please reply with the correct Indian business phone number. I won't search the web for a number or place a call. After you send it, I'll show the full call plan and ask for a separate yes. Nothing was called.${pickerHint}`
        // A number-only reply is bound to this exact question, this owner and the original task.
        await fs.saveFollowupState(tg,CALL_NUMBER_STATE,{owner:String(tg),original:cmd.text+(languageRequest?.directive ?? ''),prompt})
        const stored=await fs.getLatestFollowupState(tg,CALL_NUMBER_STATE).catch(()=>null)
        if(stored?.payload?.owner===String(tg)&&stored?.payload?.prompt===prompt) return {text:prompt,handledBy:'voice-call-number-needed'}
        return {text:`To call ${callee} I need their number. Please resend the entire request with the business number. Nothing was called.`,handledBy:'voice-call'}
      }
      const hit = { phone: general.phone, source: known ? known.source : 'the number you gave' }
      const brief = await compileCallAsk(general.ask, general.venue, guestName)
      plan = { ...voiceProfile, venue: general.venue, to: hit.phone, source: hit.source, guestName, partySize: null, date: null, dateLabel: '', timeLabel: '', flexWindow: '', seating: '',
        purpose: brief.task, opening: brief.opening, details: brief.details, kind: 'general', test: false, redials: 0, createdAt: now }
      if (named?.[1]) await rememberBookingName(tg, named[1]).catch(() => {})
      await fs.saveFollowupState(tg, PLAN_STATE, { plan, approvalHash: voicePlanHash(String(tg), plan) })
      // The number supplied in a follow-up only generated a plan; it was never itself permission to dial.
      if(numberFollowup) await fs.clearFollowupState(tg,CALL_NUMBER_STATE)
      return { text: callPlanText(plan), handledBy: 'voice-call-plan' }
    }
    const parts = stripCallBookingName(cmd.text).match(/^(?:please\s+)?(?:call|phone|ring)\s+(?:up\s+)?(.+?)\s+(?:and|to)\s+(?:book|reserve)\s+(.+)$/i)
    const venuePart = parts ? parts[1].replace(/\s+(?:on|at|via)\s+[+\d][\d\s-]{8,16}$/i, '').trim() : ''
    const bookingText = parts ? `Book ${parts[2].trim()} at ${venuePart}` : cmd.text
    const intent = rr.parseRestaurantReservationIntent(bookingText)
    // 29 Oct live: "Call Toit Indiranagar on 831… and book a table for 4 at 8 pm on Saturday" read "at 8 pm" as the
    // venue ("Calling 8 pm now"). The venue named after "call" is the venue.
    if (intent && venuePart && (!intent.restaurant || /^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(String(intent.restaurant).trim()) || !venuePart.toLowerCase().includes(String(intent.restaurant).toLowerCase().split(/\s+/)[0]))) intent.restaurant = venuePart
    if (!intent?.restaurant) return { text: 'Which restaurant should I call, and for when? For example: *call District 6 and book a table for 2 Saturday 8pm*.', handledBy: 'voice-call' }
    const explicit = indianPhoneFrom(cmd.text)
    const area = (cmd.text.match(/\bnear\s+([a-z0-9 .'-]{2,40}?)(?:\s+(?:for|on|at|this|tomorrow|today)\b|$)/i)?.[1] || '').trim()
    const previous: any = await fs.getLatestFollowupState(tg, PLAN_STATE).catch(() => null)
    const remembered = previous?.payload?.plan?.venue && String(previous.payload.plan.venue).toLowerCase() === intent.restaurant.toLowerCase() && !previous.payload.plan.test ? { phone: String(previous.payload.plan.to), source: String(previous.payload.plan.source || 'from your last plan') } : null
    const found = explicit ? { phone: explicit, source: 'the number you gave' } : (await findVenuePhone(intent.restaurant, area)) || remembered
    if (!found) return { text: `I couldn't find a phone number for ${intent.restaurant}. Send it, like *call ${intent.restaurant} on 080 1234 5678 and book a table…*. Nothing was called.`, handledBy: 'voice-call' }
    const start = intent.preferredStart || '20:00'
    const window = flexWindowLabel(start, rr.reservationClockLabel)
    plan = { ...voiceProfile, venue: intent.restaurant, to: found.phone, source: found.source, guestName, partySize: intent.partySize || 2,
      // The call says "today" when no day was named, so the booking record uses today's date too (round 6, #36).
      date: intent.requestedDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
      dateLabel: intent.requestedDate ? rr.reservationDayLabel(intent.requestedDate, start) : 'today', timeLabel: rr.reservationClockLabel(start),
      flexWindow: window, seating: /smok/i.test(cmd.text) ? (/non[\s-]?smok/i.test(cmd.text) ? 'non-smoking' : 'smoking') : 'no preference',
      purpose: `Book a table for ${intent.partySize || 2} people at ${intent.restaurant}.`, test: false, redials: 0, createdAt: now, startClock: start }
  }
  // Review (PR #1533): a name is remembered only once a plan showing it exists, never from a request that was refused.
  if (named?.[1]) await rememberBookingName(tg, named[1]).catch(() => {})
  await fs.saveFollowupState(tg, PLAN_STATE, { plan, approvalHash: voicePlanHash(String(tg), plan) })
  return { text: callPlanText(plan), handledBy: 'voice-call-plan' }
}

// ---- cron: read finished calls and report ----------------------------------------------------------------------

/** A venue's yes on the call becomes a booking in My bookings plus a 2-hour reminder (approved mock). */
async function recordPhoneBooking(telegramId: string | number, executionId: string, plan: CallPlan, outcome: CallOutcome): Promise<{ saved: boolean; reminderScheduled: boolean }> {
  // Exact owner (P0.1): only a canonical non-zero owner id is written (WhatsApp owners are negative by design). A rounded number, zero, fractional
  // or malformed id writes nothing; an id above 2^53 is written as its exact decimal string, never through Number.
  if (typeof telegramId === 'number' && !Number.isSafeInteger(telegramId)) return { saved: false, reminderScheduled: false }
  const owner = String(telegramId ?? '').trim(), legacy = Number(owner)
  if (!/^-?[1-9]\d{0,18}$/.test(owner)) return { saved: false, reminderScheduled: false }
  const ownerKey: number | string = Number.isSafeInteger(legacy) && String(legacy) === owner ? legacy : owner
  const startAt = bookedStartAt(plan, outcome)
  if (!startAt) return { saved: false, reminderScheduled: false }
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('life_events').upsert({
    telegram_id: owner, event_type: 'reservation', subtype: 'phone_booking', source: 'voice_call',
    title: `Table at ${plan.venue} · ${plan.partySize || 2} guests (phone booking)`.slice(0, 240), provider: 'phone',
    start_at: startAt, end_at: new Date(Date.parse(startAt) + 90 * 60_000).toISOString(), timezone: 'Asia/Kolkata', location: null,
    lifecycle_state: 'planned', participants: [],
    preferences_json: { partySize: plan.partySize, guestName: plan.guestName, seating: plan.seating },
    metadata_json: { restaurant: plan.venue, phone: plan.to, bookingStatus: 'confirmed_by_phone', confirmedBy: outcome.staffName, executionId },
    source_refs: [{ type: 'voice_call', execution_id: executionId }], dedupe_key: `voice_call:${executionId}`, updated_at: now,
  }, { onConflict: 'telegram_id,dedupe_key' })
  if (error) throw new Error(error.message)
  const remindAt = Date.parse(startAt) - 2 * 3600_000
  let reminderScheduled = false
  if (remindAt > Date.now()) {
    // Existing reminder PK makes interrupted/concurrent result persistence idempotent.
    const reminderId = voiceAttemptId(owner, { createdAt: executionId, purpose: 'phone-booking-reminder' }, 0)
    const { error: reminderError } = await supabaseAdmin.from('reminders').upsert({ id: reminderId, telegram_id: ownerKey, chat_id: ownerKey, message: `Table at ${plan.venue} in 2 hours (${plan.partySize || 2} guests, under ${plan.guestName}).`, remind_at: new Date(remindAt).toISOString(), sent: false, timezone: 'Asia/Kolkata' }, { onConflict: 'id', ignoreDuplicates: true })
    if (reminderError) return { saved: true, reminderScheduled: false }
    reminderScheduled = true
  }
  return { saved: true, reminderScheduled }
}

export async function processVoiceCalls(deps: { send: (to: string, text: string) => Promise<any> }) {
  const { data: runs } = await supabaseAdmin.from('agent_runs').select('id,telegram_id,metadata_json,started_at').eq('type', 'voice_call').eq('status', 'running').limit(10)
  let done = 0
  for (const run of (runs || []) as any[]) {
    const meta = run.metadata_json || {}
    const plan: CallPlan = meta.plan
    // Exact owner (P0.1): a run whose owner id is rounded, non-positive, fractional or malformed is never finalized,
    // notified or written to a conversation; it is parked for reconciliation by its unique run id.
    const owner = typeof run.telegram_id === 'number' && !Number.isSafeInteger(run.telegram_id) ? '' : String(run.telegram_id ?? '').trim()
    if (!/^-?[1-9]\d{0,18}$/.test(owner)) {
      console.error('VOICE_CALL_OWNER_INVALID:', run.id)
      await supabaseAdmin.from('agent_runs').update({ status: 'outcome_unknown', summary: 'The call owner could not be verified, so no result was sent. Check the provider outcome before repeating it.', metadata_json: { ...meta, outcome_state: 'unknown', reconciliation_required: true, owner_invalid: true }, updated_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'running')
      continue
    }
    const ownerKey: number | string = Number.isSafeInteger(Number(owner)) && String(Number(owner)) === owner ? Number(owner) : owner
    if (!meta.execution_id || meta.result_claim) {
      // A killed sender/result worker may already have called/notified. Never reclaim by age alone.
      if (!meta.execution_id || !Number.isFinite(Date.parse(String(meta.result_claimed_at || ''))) || Date.parse(String(meta.result_claimed_at || '')) > Date.now() || Date.now() - Date.parse(String(meta.result_claimed_at || '')) > 10 * 60_000) {
        await supabaseAdmin.from('agent_runs').update({ status: 'outcome_unknown', summary: 'The call or its result reporting was interrupted. Check the provider outcome before repeating it.', metadata_json: { ...meta, outcome_state: 'unknown', reconciliation_required: true }, updated_at: new Date().toISOString() }).eq('id', run.id).eq('telegram_id', String(run.telegram_id)).eq('status', 'running')
      }
      continue
    }
    let exec: any
    try { exec = await getExecution(String(meta.execution_id)) } catch (err: any) { console.error('VOICE_CALL_READ_FAILED:', run.id, String(err?.message || err).slice(0, 160)); continue }
    const status = String(exec?.status || '')
    const tooOld = Date.now() - Date.parse(String(run.started_at)) > 20 * 60_000
    if (!TERMINAL.has(status) && !tooOld) continue
    const resultClaim = randomUUID()
    const { data: claimed, error: claimError } = await supabaseAdmin.from('agent_runs').update({ metadata_json: { ...meta, result_claim: resultClaim, result_claimed_at: new Date().toISOString() } })
      .eq('id', run.id).eq('telegram_id', String(run.telegram_id)).eq('status', 'running').is('metadata_json->>result_claim', null).select('id').maybeSingle()
    if (claimError || !claimed) continue
    const transcript = String(exec?.transcript || '')
    let outcome: CallOutcome | null = null
    if (status === 'completed' && transcript && !plan.test) {
      // 21 Oct live: Mercury spent its whole 300-token budget on reasoning and returned nothing, so a finished
      // call read as "couldn't read a clear answer". Claude Haiku reads it; Mercury (bigger budget) is the fallback.
      const prompt = plan.kind === 'general'
        ? `Read this phone call transcript. The caller's task was: ${plan.purpose}\nReply with JSON only: {"done": true if the other side clearly confirmed or completed that task, or clearly answered the question (a clear no or not available is still an answer), "confirmed": "exactly what they said or confirmed (day, time, room, doctor, price, yes or no) in a few words" or null, "staff_name": name or null, "callback_time": when they asked to be called back or null, "notes": one short plain sentence on what happened; if a recorded phone menu answered and no person came on, say exactly that}.\n\nTranscript:\n${transcript.slice(-6000)}`
        : `Read this restaurant booking phone call transcript. Reply with JSON only: {"booked": true only if the restaurant clearly confirmed a table, "confirmed_time": "8:00 pm" or null, "staff_name": name or null, "callback_time": when they asked to be called back or null, "notes": one short plain sentence on what happened; if a recorded phone menu answered and no person came on, say exactly that}.\nRequested: table for ${plan.partySize} ${plan.dateLabel} at ${plan.timeLabel}.\nTranscript:\n${transcript.slice(-6000)}`
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const res: any = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({ model: 'claude-haiku-4-5', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
        outcome = parseOutcome(String(res?.content?.[0]?.text || ''))
      } catch (err: any) { console.error('VOICE_CALL_OUTCOME_CLAUDE_FAILED:', String(err?.message || err).slice(0, 120)) }
      if (!outcome) {
        const { askMercury } = await import('@/lib/services/mercury')
        const r = await askMercury(prompt, { maxTokens: 2000, label: 'voice_call_outcome' }).catch(() => null)
        outcome = parseOutcome(r?.text || '')
      }
    }
    let saved = { saved: false, reminderScheduled: false }
    // A general call (room, appointment, enquiry) is reported, never written to My bookings as a table.
    if (status === 'completed' && outcome?.booked && !plan.test && plan.kind !== 'general') saved = await recordPhoneBooking(owner, String(meta.execution_id), plan, outcome).catch((err: any) => { console.error('VOICE_CALL_RECORD_FAILED:', run.id, String(err?.message || err).slice(0, 160)); return { saved: false, reminderScheduled: false } })
    const outcomeUncertain = !TERMINAL.has(status) || (status !== 'completed' && Boolean(transcript.trim()))
    const text = !outcomeUncertain ? callResultText(plan, status, outcome, transcript.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 160) || '', saved.saved, saved.reminderScheduled) : `I couldn't confirm the outcome of the call to ${plan.venue}. I haven't repeated it. Check the task before trying again.`
    const at = new Date().toISOString()
    const { data: finalized, error: finalizeError } = await supabaseAdmin.from('agent_runs').update({ status: outcomeUncertain ? 'outcome_unknown' : status === 'completed' ? 'completed' : 'failed', progress: 100, summary: text.slice(0, 500), completed_at: at, updated_at: at,
      metadata_json: { ...meta, result_claim: resultClaim, result_claimed_at: new Date().toISOString(), final_status: status, outcome, booking_saved: saved.saved, reminder_scheduled: saved.reminderScheduled, reconciliation_required: outcomeUncertain, recording_url: exec?.telephony_data?.recording_url || null } }).eq('id', run.id).eq('telegram_id', String(run.telegram_id)).eq('status', 'running').eq('metadata_json->>result_claim', resultClaim).select('id').maybeSingle()
    if (finalizeError || !finalized) continue
    const { data: user } = await supabaseAdmin.from('users').select('whatsapp_id,telegram_id').eq('telegram_id', ownerKey).maybeSingle()
    const ownUser = user && (user.telegram_id == null || String(user.telegram_id) === owner) ? user : null
    try { if (ownUser?.whatsapp_id) await deps.send(String(ownUser.whatsapp_id), text) } catch {}
    await supabaseAdmin.from('conversations').insert({ telegram_id: ownerKey, role: 'assistant', content: text })
    done++
  }
  return done
}
