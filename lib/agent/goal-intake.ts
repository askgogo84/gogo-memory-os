// Same Brain 3.0, Addendum 5 (Goal-to-Done), P0 bulk delegation: "Gogo, here are ten things I need to finish this week."
//
// One message with several goals becomes a plan the person can read: the goals, each with who does it (Gogo handles /
// We do together / Your turn), and only the details that are missing, asked once. Nothing starts until they say
// "get it done" (or go ahead, start). Then everything that has what it needs starts, each goal as its own durable run
// through the tools it would have used anyway, with every approval it would have needed anyway:
// - reminders, flight prices, research and to-dos: one persistent run each (persistent-general-plan.ts), which
//   checks its own result, survives the worker dying (cron resume) and shows on Tasks.
// - an event: the Events flow (lib/events), which drafts; nothing is sent to anyone from there.
// - an email: the Gmail compose flow, which only drafts; "send it" raises an approval card. One draft at a time.
// - anything else: listed as the person's, never guessed at.
//
// The model reads the message and fills facts (kind, the person's words, dates, names). It never writes replies,
// never decides who does what, never decides what may start. Code does all three. Off unless GOGO_GOAL_INTAKE is "on"
// or lists the owner.
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import type { AgentActor } from './actor'
import type { TaskOwnership } from './task-ownership'

type Env = Record<string, string | undefined>
const envOf = () => ((globalThis as any).process?.env || {}) as Env

/** The dashboard chat has its own switch on top of the main one, so the web path can be verified, or turned off,
 *  without touching WhatsApp. Same values: "on" or exact owner ids. */
export function goalIntakeWebEnabledFor(owner: string, env: Env = envOf()): boolean {
  const v = String(env.GOGO_GOAL_INTAKE_WEB || '').trim()
  if (!owner || !goalIntakeEnabledFor(owner, env)) return false
  return v === 'on' || v.split(',').map(s => s.trim()).includes(owner)
}
export function goalIntakeEnabledFor(owner: string, env: Env = envOf()): boolean {
  const v = String(env.GOGO_GOAL_INTAKE || '').trim()
  if (v === 'off' || !owner) return false
  if (v === 'on') return true
  // Exact owner ids, as GOGO_EVENTS_OWNERS lists them.
  return v.split(',').map(s => s.trim()).includes(owner)
}

export const KINDS = ['reminder', 'flight_prices', 'research', 'email', 'event', 'todo', 'other'] as const
export type GoalKind = typeof KINDS[number]
export const SLOTS = ['from', 'to', 'date', 'time', 'recipient', 'topic', 'people'] as const
export type Slot = typeof SLOTS[number]
export type Slots = Partial<Record<Slot, string>>

/** What each kind needs before it can start. Never guessed: a missing one is asked for, once. */
export const REQUIRED: Record<GoalKind, readonly Slot[]> = {
  // An event needs to know what it is and whose ("Divya's birthday"): 11 Nov live, "organize a birthday" with only a
  // date reached Events with no name, was asked "What should I call the event?", and no draft was made. It needs a
  // start time too: Events keeps a date only together with a time, so a date alone would be dropped from the draft.
  reminder: ['date', 'time'], flight_prices: ['from', 'to', 'date'], research: [], email: ['recipient', 'topic'], event: ['topic', 'date', 'time'], todo: [], other: [],
}
/** Who does it. Responsibility only: every tool still asks for every approval it needs (task-ownership.ts). */
export const OWNER_OF: Record<GoalKind, TaskOwnership> = {
  reminder: 'gogo_handles', flight_prices: 'gogo_handles', research: 'gogo_handles', email: 'together', event: 'together', todo: 'your_turn', other: 'your_turn',
}
const QUESTION: Record<Slot, string> = {
  from: 'flying from where?', to: 'to where?', date: 'which date?', time: 'what time?', recipient: 'who is it to?', topic: 'what should it say?', people: 'for how many people?',
}
const REMINDER_Q: Partial<Record<Slot, string>> = { date: 'which day?', time: 'what time should I remind you?' }

export type IntakeGoal = {
  id: string; kind: GoalKind; title: string; words: string; slots: Slots; ownership: TaskOwnership
  asked: Slot[]; state: 'open' | 'started' | 'held' | 'dropped'; runId?: string; note?: string; reply?: string
}
export type IntakePlan = { v: 1; id: string; at: string; text: string; goals: IntakeGoal[]; started?: string; strays?: number }
export const MAX_GOALS = 10
const PLAN_MINUTES = 120

/** Like clip, keeping line breaks (answers with bullets and source lists) and never cutting inside a line. */
const block = (v: unknown, n: number) => { const t = String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); if (t.length <= n) return t; const cut = t.slice(0, n); return cut.slice(0, Math.max(cut.lastIndexOf('\n'), n - 400)).trimEnd() + '\n…' }
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const norm = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\b(?:the|a|an|my|for|to|of|me|about|please)\b/g, ' ').replace(/\s+/g, ' ').trim()

/** Start in the first reply (owner-approved mock, 11 Nov): Gogo looks at the calendar before asking what time a
 *  meeting is, and sets going at once the goals that need no answer and reach nobody else (research, a fare search, a
 *  reminder, a to-do). Events and emails still wait for "get it done". Off unless GOGO_GOAL_EARLY_START is "on" or lists
 *  the owner. */
export function goalEarlyStartEnabledFor(owner: string, env: Env = envOf()): boolean {
  const v = String(env.GOGO_GOAL_EARLY_START || '').trim()
  return goalIntakeEnabledFor(owner, env) && (v === 'on' || v.split(',').map(s => s.trim()).includes(owner))
}
const EARLY_KINDS: readonly GoalKind[] = ['research', 'flight_prices', 'reminder', 'todo']
// Only "remind me about/of/for/before my meeting(s) …": the reminder is about attending something on the calendar.
// "Remind me to cancel the meeting", "remind me to give Divya a call", "sync my contacts" are things to do and keep their
// own question (11 Nov review).
const MEETING_NOUN = '(?:meetings?|appointments?|stand[- ]?ups?|calls?|interviews?|syncs?|reviews?)'
const MEETING_WORDS = new RegExp(`\\bremind\\s+me\\s+(?:about|of|for|before|ahead\\s+of)\\s+(?:all\\s+)?(?:my|the|our|tomorrow['’]?s?|today['’]?s?|these|those)\\s+(?:[\\p{L}'’-]+\\s+){0,3}?${MEETING_NOUN}\\b`, 'iu')
const PLURAL_MEETINGS = new RegExp(`\\b(?:all\\s+)?(?:my|the|our|these|those)\\s+(?:[\\p{L}'’-]+\\s+){0,3}?(?:meetings|appointments|stand[- ]?ups|calls|interviews|syncs|reviews)\\b`, 'iu')
export const meetingReminderWords = (words: string) => MEETING_WORDS.test(words) && !/\bremind\s+me\s+to\b/i.test(words)
// Blocks that are not meetings to attend.
const NOT_A_MEETING = /^(?:busy|lunch|break|focus(?:\s+time)?|ooo|out of (?:the )?office|holiday|leave|vacation|birthday|commute|travel|block(?:ed)?|do not book|dnd|gym|workout)\b/i
export type CalendarDay = { ok: boolean; events: { title: string; time: string }[]; skipped?: number }

/** Cheap gate before any model call: a numbered or bulleted list of three or more lines, "here are N things", or one
 *  sentence asking for three or more separate things. A false positive costs one model call; it never acts. */
export function looksLikeGoalList(text: string): boolean {
  const t = String(text || '').trim()
  if (t.length < 30 || t.length > 3000) return false
  const lines = t.split(/\n+/).filter(l => /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/.test(l))
  if (lines.length >= 3) return true
  if (/\b(?:here(?:'s| is| are)|i have|i've got|i need to (?:do|finish|get done))\b[^.?!]{0,40}\b(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|few|several|bunch of|list of)\s+(?:things|tasks|items|stuff|errands)\b/i.test(t)) return true
  const parts = t.split(/,|;|\band then\b|\balso\b|\band\b/i).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 2)
  const verbs = parts.filter(s => /^(?:(?:i\s+)?(?:need|want|have)\s+to\s+|please\s+|gogo,?\s+(?:i\s+need\s+to\s+)?)?(?:organi[sz]e|plan|check|compare|find|prepare|draft|write|send|email|remind|book|research|look\s+up|get|buy|call|schedule|set\s+up|pay|renew|order|track|sort)\b/i.test(s))
  return verbs.length >= 3
}

// ---- The model's part: facts only, through forced tool calls. ----

export const LIST_TOOL: Anthropic.Tool = {
  name: 'goal_list',
  description: 'The separate goals in one message from a person to their assistant.',
  input_schema: {
    type: 'object',
    properties: {
      is_list: { type: 'boolean', description: 'true only if the message asks the assistant to take on two or more separate goals.' },
      goals: {
        type: 'array', maxItems: MAX_GOALS,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...KINDS], description: 'reminder = remind them of something. flight_prices = look up or compare flight fares. research = find, look up, compare or shortlist information (investors, venues, products). email = write an email. event = organise a party, birthday, dinner, outing or get-together they host. todo = something only they can do (call someone, go somewhere, pay, sign). other = anything else.' },
            title: { type: 'string', description: 'A short name for the goal in the person\'s own words, 60 characters at most.' },
            words: { type: 'string', description: 'What they asked for this goal, close to their own words, 200 characters at most.' },
            from: { type: 'string', description: 'flight_prices: departure city, only if stated.' },
            to: { type: 'string', description: 'flight_prices: arrival city, only if stated.' },
            date: { type: 'string', description: 'YYYY-MM-DD, only if a specific day was stated or a relative day ("tomorrow") was. Not for a month or a range.' },
            time: { type: 'string', description: 'HH:MM 24-hour, only if a time was stated.' },
            recipient: { type: 'string', description: 'email: who it is to (a name or an email address), only if stated.' },
            topic: { type: 'string', description: 'email: what it should say. event: what the occasion is and whose, in their words ("Divya\'s birthday", "team offsite"); a bare "a birthday" with no person is not enough. Only if stated.' },
            people: { type: 'integer', description: 'event: number of people, only if stated.' },
          },
          required: ['kind', 'title', 'words'],
        },
      },
    },
    required: ['is_list', 'goals'],
  },
}
export const ANSWER_TOOL: Anthropic.Tool = {
  name: 'goal_answers',
  description: 'How a person\'s reply relates to the plan of goals their assistant just showed them.',
  input_schema: {
    type: 'object',
    properties: {
      about_plan: { type: 'boolean', description: 'true if the reply answers questions about these goals, changes or drops one, or tells the assistant to start. false if it is about something else.' },
      start: { type: 'boolean', description: 'true only if they told the assistant to go ahead (get it done, go ahead, start, do it, yes do them).' },
      fills: { type: 'array', items: { type: 'object', properties: { goal: { type: 'string' }, slot: { type: 'string', enum: [...SLOTS] }, value: { type: 'string' } }, required: ['goal', 'slot', 'value'] }, description: 'Details they gave, each for one goal id. Dates as YYYY-MM-DD, times as HH:MM 24-hour, people as a number. For an event, slot "topic" is what the occasion is and whose ("Divya\'s birthday").' },
      drop: { type: 'array', items: { type: 'string' }, description: 'Goal ids they said to drop or not do.' },
    },
    required: ['about_plan', 'start'],
  },
}
export type ListExtraction = { is_list: boolean; goals: any[] }
export type AnswerExtraction = { about_plan: boolean; start: boolean; fills?: { goal: string; slot: string; value: string }[]; drop?: string[] }
export type Model = { list: (p: { text: string; today: string; timezone: string }) => Promise<ListExtraction | null>; answers: (p: { text: string; today: string; timezone: string; goals: { id: string; kind: string; title: string; missing: Slot[] }[] }) => Promise<AnswerExtraction | null> }

const realModel: Model = {
  async list(p) {
    return callTool(LIST_TOOL, [`You read one message a person sent their assistant and list the separate goals in it. Today is ${p.today} (${p.timezone}).`,
      'Fill a field only if the person stated it. Never invent a date, time, place, name or number. Two requests for the same thing are one goal.',
      'A greeting, a question or a single request is not a list: is_list false.'].join('\n'), p.text, 'goal_list') as Promise<ListExtraction | null>
  },
  async answers(p) {
    return callTool(ANSWER_TOOL, [`A person's assistant showed them these goals and asked for missing details. Today is ${p.today} (${p.timezone}).`,
      ...p.goals.map(g => `- ${g.id}: ${g.kind}, "${g.title}"${g.missing.length ? `, missing: ${g.missing.join(', ')}` : ''}`),
      'Read their reply. Fill only details they stated, each for the goal it belongs to. Never invent one.'].join('\n'), p.text, 'goal_answers') as Promise<AnswerExtraction | null>
  },
}
async function callTool(tool: Anthropic.Tool, system: string, text: string, source: string): Promise<unknown> {
  const [{ FAST_MODEL }, { forModel }, { recordMeterEvent }] = await Promise.all([import('./brain'), import('@/lib/services/model-ids'), import('@/lib/metering/record')])
  const t0 = Date.now()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const res: any = await client.messages.create(forModel({ model: FAST_MODEL, max_tokens: 1200, system, tools: [tool], tool_choice: { type: 'tool' as const, name: tool.name },
    messages: [{ role: 'user' as const, content: String(text).slice(0, 3000) }] }), { timeout: 15_000 })
  void recordMeterEvent({ vendor: 'anthropic', category: 'llm', model: FAST_MODEL, inputTokens: res?.usage?.input_tokens ?? null, outputTokens: res?.usage?.output_tokens ?? null, ok: true, metadata: { source: `goal_intake_${source}`, ms: Date.now() - t0 } } as any)
  const use = Array.isArray(res?.content) ? res.content.find((b: any) => b?.type === 'tool_use' && b.name === tool.name) : null
  return use?.input ?? null
}

// ---- Code's part: checking what the model said, deciding, and wording. ----

const DATE = /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/, TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
/** One slot value from the model, checked; anything that does not check out is treated as not stated. */
export function slotValue(slot: Slot, raw: unknown, today: string): string | null {
  const v = clip(raw, 120)
  if (!v) return null
  if (slot === 'date') { const d = new Date(`${v}T00:00:00Z`); return DATE.test(v) && v >= today && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null }
  if (slot === 'time') return TIME.test(v) ? v : null
  if (slot === 'people') { const n = /^\d{1,4}$/.test(v) ? Number(v) : NaN; return n >= 1 && n <= 5000 ? String(n) : null }
  if (slot === 'from' || slot === 'to') return /^[\p{L} .'-]{2,40}$/u.test(v) ? v : null
  // A name or one email address: no separators that could start a second recipient or a header.
  if (slot === 'recipient') return /^[\p{L}\p{N} .'@_+-]{2,80}$/u.test(v) ? v : null
  return v
}
export const missingOf = (g: Pick<IntakeGoal, 'kind' | 'slots'>) => REQUIRED[g.kind].filter(s => !g.slots[s])

/** Turns the model's list into checked goals: known kinds only, own words clipped, slots checked, repeats merged. */
export function goalsFrom(extraction: ListExtraction | null, today: string): IntakeGoal[] {
  if (!extraction || extraction.is_list !== true || !Array.isArray(extraction.goals)) return []
  const out: IntakeGoal[] = []
  for (const raw of extraction.goals.slice(0, MAX_GOALS)) {
    if (!raw || typeof raw !== 'object') continue
    const kind: GoalKind = (KINDS as readonly string[]).includes(raw.kind) ? raw.kind : 'other'
    const title = clip(raw.title, 60), words = clip(raw.words || raw.title, 200)
    if (!title) continue
    const slots: Slots = {}
    for (const s of SLOTS) { const v = slotValue(s, raw[s], today); if (v) slots[s] = v }
    const dup = out.find(g => g.kind === kind && (norm(g.title) === norm(title) || norm(g.words) === norm(words)))
    if (dup) { for (const s of SLOTS) if (!dup.slots[s] && slots[s]) dup.slots[s] = slots[s]; continue }
    out.push({ id: `g${out.length + 1}`, kind, title, words, slots, ownership: OWNER_OF[kind], asked: [], state: 'open' })
  }
  return out.length >= 2 ? out : []
}

/** Applies a reply: checked fills for open goals only, drops, and whether to start. */
export function applyAnswers(plan: IntakePlan, ans: AnswerExtraction | null, today: string): { plan: IntakePlan; start: boolean; about: boolean } {
  if (!ans || ans.about_plan !== true) return { plan, start: false, about: false }
  const goals = plan.goals.map(g => ({ ...g, slots: { ...g.slots } }))
  for (const f of Array.isArray(ans.fills) ? ans.fills.slice(0, 40) : []) {
    const g = goals.find(x => x.id === f?.goal && x.state === 'open')
    if (!g || !(SLOTS as readonly string[]).includes(f.slot)) continue
    const v = slotValue(f.slot as Slot, f.value, today)
    if (v) g.slots[f.slot as Slot] = v
  }
  for (const id of Array.isArray(ans.drop) ? ans.drop : []) { const g = goals.find(x => x.id === id && x.state === 'open'); if (g) g.state = 'dropped' }
  return { plan: { ...plan, goals }, start: ans.start === true, about: true }
}

const LABEL: Record<TaskOwnership, string> = { gogo_handles: 'Gogo handles', together: 'We do together', your_turn: 'Your turn' }
const LINE: Partial<Record<GoalKind, string>> = {
  email: 'I’ll draft it; nothing is sent until you approve it.', event: 'I’ll start a draft event; nothing goes to any guest from here.',
  todo: 'Only you can do this. I’ll put it on your to-do list.', other: 'Tell me more if you want me to take any of it on.',
}
/** The questions still to ask for a goal: each detail only once. */
export function toAsk(g: IntakeGoal): Slot[] { return missingOf(g).filter(s => !g.asked.includes(s)) }
const EVENT_Q: Partial<Record<Slot, string>> = { topic: 'what is the occasion (and whose)?', time: 'what time does it start?' }
function question(g: Pick<IntakeGoal, 'kind'> & { note?: string }, s: Slot) { return (g.kind === 'reminder' && s === 'time' && g.note === 'calendar_empty' && 'I don’t see a timed meeting on your calendar that day. What time should I remind you?') || (g.kind === 'reminder' && s === 'time' && g.note?.startsWith('calendar_pick:') && `That day you have ${g.note.slice(14)}. Which one, and what time should I remind you?`) || (g.kind === 'reminder' && REMINDER_Q[s]) || (g.kind === 'event' && EVENT_Q[s]) || QUESTION[s] }

/** The details Gogo has for a goal, said back so a wrong one is seen before anything starts. Only what was given. */
export function detailOf(g: IntakeGoal): string {
  // Shown as plain text: WhatsApp formatting marks and quote marks in a detail are dropped for display only.
  const show = (v: unknown, n: number) => { const t = clip(v, 200).replace(/[*_~`“”"]/g, '').trim(); return t.length > n ? `${t.slice(0, n).trim()}…` : t }
  // "2026-11-12" is said as "Thu 12 Nov" and "14:30" as "2:30 pm"; anything else is shown as given.
  const day = (v: string) => { const m = v.match(/^(\d{4})-(\d\d)-(\d\d)$/); if (!m) return v; const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d).replace(',', '') : v }
  const clock = (v: string) => { const m = v.match(/^([01]?\d|2[0-3]):([0-5]\d)$/); if (!m) return v; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}` }
  const s = { from: show(g.slots.from, 40), to: show(g.slots.to, 40), date: day(show(g.slots.date, 20)), time: clock(show(g.slots.time, 10)), recipient: show(g.slots.recipient, 60), topic: show(g.slots.topic, 80), people: show(g.slots.people, 10) }
  const on = s.date ? [s.date, s.time].filter(Boolean).join(' at ') : s.time ? `at ${s.time}` : ''
  if (g.kind === 'reminder') return on ? (s.date ? `for ${on}` : on) : ''
  if (g.kind === 'flight_prices') return [s.from && s.to ? `${s.from} to ${s.to}` : s.from ? `from ${s.from}` : s.to ? `to ${s.to}` : '', s.date ? `on ${s.date}` : ''].filter(Boolean).join(' ')
  if (g.kind === 'email') return [s.recipient ? `to ${s.recipient}` : '', s.topic ? `about “${s.topic}”` : ''].filter(Boolean).join(', ')
  if (g.kind === 'event') return [s.topic, on ? (s.date ? `on ${on}` : on) : '', s.people ? `for ${s.people} ${s.people === '1' ? 'person' : 'people'}` : ''].filter(Boolean).join(', ')
  return ''
}

/** The plan as a WhatsApp message. Marks the questions it asks as asked. */
export function planText(plan: IntakePlan): { text: string; plan: IntakePlan } {
  const goals = plan.goals.map(g => ({ ...g, asked: [...g.asked] }))
  const live = goals.filter(g => g.state === 'open')
  const lines: string[] = [`I count ${live.length} thing${live.length === 1 ? '' : 's'}. Here’s who does what:`]
  let n = 0, asking = false
  for (const o of ['gogo_handles', 'together', 'your_turn'] as TaskOwnership[]) {
    const group = live.filter(g => g.ownership === o)
    if (!group.length) continue
    lines.push('', `*${LABEL[o]}*`)
    for (const g of group) {
      const qs = toAsk(g)
      if (qs.length) asking = true
      g.asked.push(...qs)
      const extra = [LINE[g.kind], qs.length ? qs.map(s => question(g, s)).join(' ').replace(/^./, c => c.toUpperCase()) : ''].filter(Boolean).join(' ')
      const have = detailOf(g)
      lines.push(`${++n}. ${g.title}${have ? ` (${have})` : ''}${extra ? `: ${extra}` : ''}`)
    }
  }
  lines.push('', asking ? 'Answer what you can in one message, then say *get it done*. I’ll start everything that has what it needs.' : 'Say *get it done* and I’ll start them. Anything that needs your yes will still ask first.')
  return { text: lines.join('\n'), plan: { ...plan, goals } }
}

/** The instruction each kind of goal becomes, written by code from checked details (never the model's prose alone). */
export function stepFor(g: IntakeGoal): { tool: 'reminders' | 'travel' | 'web_search' | 'tasks'; title: string; instruction: string; reminder?: { date: string; time: string; message: string } } | null {
  const s = g.slots
  const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` }
  // The reminder's own words: what they asked to be reminded of, without the "remind me" and the day. The day, time
  // and words go to the reminder tool as checked values (`reminder`), never as a sentence for it to re-read; the
  // instruction is only what the task shows.
  if (g.kind === 'reminder' && s.date && s.time) {
    const about = (g.words.replace(/^(?:please\s+)?remind\s+me\s+(?:to\s+|about\s+|of\s+)?/i, '').replace(/[\s,]*\b(?:day after tomorrow|tomorrow|today|tonight)\b[\s.!]*$/i, '').trim() || g.title).replace(/^./, c => c.toUpperCase())
    return { tool: 'reminders', title: 'Set reminder', instruction: `Set a reminder on ${s.date} at ${clock(s.time)}`, reminder: { date: s.date, time: s.time, message: about } }
  }
  if (g.kind === 'flight_prices' && s.from && s.to && s.date) return { tool: 'travel', title: g.title, instruction: `Compare flights from ${s.from} to ${s.to} on ${s.date}` }
  if (g.kind === 'research') return { tool: 'web_search', title: g.title, instruction: g.words }
  // The tasks tool takes the quoted words as the to-do; it skips texts that start like one of a planner's own steps
  // ("check…", "verify…"), so those are phrased as a note to self.
  if (g.kind === 'todo') { const t = g.title.replace(/["“”]/g, '').trim(); return t ? { tool: 'tasks', title: g.title, instruction: `Add a task: ${/^(?:retrieve|look up|check|verify|ensure)\b/i.test(t) ? `Remember to ${t.replace(/^./, c => c.toLowerCase())}` : t}` } : null }
  return null
}

export type StartDeps = {
  /** Where the list was given: runs and the event draft are recorded against that surface. Default WhatsApp. */
  surface?: 'whatsapp' | 'web'
  /** Start only these goals (the early start); the rest are left exactly as they are. */
  only?: (g: IntakeGoal) => boolean
  startRun?: (p: { actor: AgentActor; goal: IntakeGoal; step: NonNullable<ReturnType<typeof stepFor>>; plan: IntakePlan; surface?: 'whatsapp' | 'web' }) => Promise<{ runId: string; drive: () => Promise<{ status: string; text: string }> }>
  event?: (actor: AgentActor, text: string, surface?: 'whatsapp' | 'web') => Promise<string | null>
  email?: (actor: AgentActor, text: string) => Promise<string | null>
  eventsOn?: (owner: string) => boolean
  capabilityOff?: (actor: AgentActor, capability: 'reminders' | 'browser' | 'email') => Promise<boolean>
  now?: Date
}
/** "2026-11-11T09:30" in the person's own zone, for comparing with a reminder's day and time. */
function localNow(zone: string, now: Date = new Date()): string {
  const f = (z: string) => { const p: Record<string, string> = {}; for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` }
  try { return f(zone) } catch { return f('Asia/Kolkata') }
}
export const MAX_PARALLEL = 3
const FLIGHT_EXTRAS = /\b(?:return|round[- ]?trip|two[- ]way|both ways|kids?|child(?:ren)?|infants?|bab(?:y|ies)|adults?|people|persons?|passengers?|family|of us|budget|under|below|less than|cheaper than|max(?:imum)?|business|first class|premium|non[- ]?stop|direct|morning|afternoon|evening|night|red[- ]?eye|before|after|baggage|luggage|refundable)\b|₹|\brs\.?\s?\d|\b\d+\s?k\b/i
export type Started = { goal: IntakeGoal; running?: Promise<{ status: string; text: string }>; reply?: string | null }

/** Starts every open goal that has what it needs. Returns what started (to be driven by the caller) and the plan. */
export async function startGoals(actor: AgentActor, plan: IntakePlan, deps: StartDeps = {}): Promise<{ plan: IntakePlan; started: Started[] }> {
  const owner = String(actor.legacyTelegramId)
  const goals = plan.goals.map(g => ({ ...g }))
  const started: Started[] = []
  let emailTaken = false
  // At most three runs work at once; each is set going the moment it exists (so the background sweeper, which only
  // picks up runs left idle, never reports one this request is still working on).
  let active = 0; const waiting: (() => void)[] = []
  const slot = async <T>(work: () => Promise<T>): Promise<T> => {
    while (active >= MAX_PARALLEL) await new Promise<void>(r => waiting.push(r))
    active++
    try { return await work() } finally { active--; waiting.shift()?.() }
  }
  const FAILED = { status: 'failed', text: 'I couldn’t finish this one. It is on your Tasks page.' }
  for (const g of goals) {
    if (g.state !== 'open' || missingOf(g).length || (deps.only && !deps.only(g))) continue
    try {
      const step = stepFor(g)
      if (step) {
        // The owner's own off switch for this kind of work is honoured before anything is created.
        const needs = step.tool === 'reminders' ? 'reminders' as const : step.tool === 'web_search' ? 'browser' as const : null
        if (needs && await (deps.capabilityOff || realCapabilityOff)(actor, needs)) { g.state = 'held'; g.note = needs === 'reminders' ? 'capability_off' : 'browser_off'; continue }
        // A flight ask with conditions the simple fare search does not carry (a return leg, children, several
        // travellers, a budget, a cabin, a time of day) is not searched as something simpler than what was asked.
        if (g.kind === 'flight_prices' && FLIGHT_EXTRAS.test(g.words)) { g.state = 'held'; g.note = 'flight_details'; continue }
        // A reminder for a time that has already gone by is asked about, not attempted.
        if (step.reminder && `${step.reminder.date}T${step.reminder.time}` <= localNow(actor.timezone || 'Asia/Kolkata', deps.now)) { g.state = 'held'; g.note = 'time_passed'; continue }
        const run = await (deps.startRun || realStartRun)({ actor, goal: g, step, plan, surface: deps.surface })
        g.state = 'started'; g.runId = run.runId
        started.push({ goal: g, running: slot(() => run.drive()).catch(() => FAILED) })
      } else if (g.kind === 'event') {
        const on = (deps.eventsOn || realEventsOn)(owner)
        if (!on) { g.state = 'held'; g.note = 'events_off'; continue }
        const reply = await (deps.event || realEvent)(actor, `Plan an event: ${clip(g.slots.topic, 80) || g.words}${g.slots.date ? ` on ${g.slots.date}` : ''}${g.slots.time ? ` at ${g.slots.time}` : ''}${g.slots.people ? ` for ${g.slots.people} people` : ''}`, deps.surface)
        // Started only when a draft really exists.
        const made = Boolean(reply && /^Draft started\./.test(reply))
        g.state = made ? 'started' : 'held'; if (!made) g.note = 'event_not_started'
        if (made) started.push({ goal: g, reply })
      } else if (g.kind === 'email') {
        // Gogo keeps one email draft at a time; the next waits until this one is sent or dropped.
        if (emailTaken) { g.state = 'held'; g.note = 'one_draft_at_a_time'; continue }
        // Email switched off in the person's settings: not drafted, and said so.
        if (await (deps.capabilityOff || realCapabilityOff)(actor, 'email')) { g.state = 'held'; g.note = 'email_off'; continue }
        emailTaken = true
        const reply = await (deps.email || realEmail)(actor, `email ${g.slots.recipient} saying ${g.slots.topic}`)
        // Started only when a draft really exists ("Connect Gmail first" or "which address?" is not a draft).
        const drafted = Boolean(reply && /Nothing has been sent/.test(reply))
        g.state = drafted ? 'started' : 'held'; if (!drafted) { g.note = 'email_not_started'; g.reply = reply ? clip(reply, 300) : undefined; emailTaken = false }
        if (drafted) started.push({ goal: g, reply })
      }
    } catch (err: any) {
      console.error('GOAL_INTAKE_START_FAILED:', JSON.stringify({ kind: g.kind, code: String(err?.message || 'error').replace(/[^a-z0-9_:]/gi, '').slice(0, 60) }))
      g.state = 'held'; g.note = 'start_failed'
    }
  }
  return { plan: { ...plan, goals, started: new Date().toISOString() }, started }
}

// A dashboard request can live longer than a WhatsApp one; the background sweeper leaves a web goal run alone for this
// long so the request that created it and the sweeper never drive the same run.
const WEB_LIVE_MS = 330_000
const realStartRun: NonNullable<StartDeps['startRun']> = async ({ actor, goal, step, plan, surface }) => {
  const { startPersistentGoalRun } = await import('./persistent-general-plan')
  // The mission text is the instruction code wrote, not the person's first wording ("next month"), which the flight
  // reader would read as contradicting the exact date they then gave.
  return startPersistentGoalRun({ actor, surface: surface === 'web' ? 'web' : 'whatsapp', step: { tool: step.tool, title: step.title, instruction: step.instruction } as any, missionText: step.instruction, metadata: { goal_batch_id: plan.id, goal_id: goal.id, goal_kind: goal.kind, goal_title: goal.title, ownership: goal.ownership, ...(step.reminder ? { goal_reminder: step.reminder } : {}), // notified:true is the marker the outcome gateway (app and database) already honours for a run that reports its own
    // result: a web goal is never announced on WhatsApp, whichever path closes it.
    ...(surface === 'web' ? { goal_surface: 'web', notified: true } : {}) }, liveMs: surface === 'web' ? WEB_LIVE_MS : undefined })
}
const realEventsOn = (owner: string) => { const env = envOf(); return env.GOGO_EVENTS === '1' || String(env.GOGO_EVENTS_OWNERS || '').split(',').map(s => s.trim()).includes(owner) }
const realCapabilityOff = async (actor: AgentActor, capability: 'reminders' | 'browser' | 'email') => (await import('./adaptive-autonomy')).capabilityIsOff(actor.legacyTelegramId, capability)
// Create only: from a list, the Events flow may start a new draft and nothing else. Publishing, changing or
// cancelling an event, or touching its guests, is never done on the strength of one line in a list.
const realEvent = async (actor: AgentActor, text: string, surface?: 'whatsapp' | 'web') => {
  const [entry, { extractEventAction }] = await Promise.all([import('@/lib/events/entry'), import('@/lib/events/extract')])
  return entry.tryEventAsk(actor, text, surface === 'web' ? 'dashboard' : 'whatsapp', { extract: async input => { const a = await extractEventAction(input); return a && a.action === 'create' ? a : ({ action: 'none' } as any) } })
}
const realEmail = async (actor: AgentActor, text: string) => {
  const r: any = await (await import('./gmail-send')).tryRunGmailSendCommand({ actor, text })
  return r?.text ? String(r.text) : null
}

/** Why a goal did not start, in one line. */
export function heldLine(g: IntakeGoal): string {
  if (g.note === 'one_draft_at_a_time') return `⏸ ${g.title}: not started. I keep one email draft at a time; ask me for this one after the first is sent or dropped.`
  if (g.note === 'email_off') return `⏸ ${g.title}: email is switched off in your settings, so I did not draft it. To change that, say: set email autonomy to draft.`
  if (g.note === 'browser_off') return `⏸ ${g.title}: web research is switched off in your settings, so I did not start it.`
  if (g.note === 'flight_details') return `⏸ ${g.title}: not started. This one has conditions (travellers, return, budget or timing) I’d rather get right; ask me for this flight search on its own.`
  if (g.note === 'time_passed') return `⏸ ${g.title}: that time has already passed. Tell me a new time and I’ll set it.`
  if (g.note === 'email_not_started') return `⏸ ${g.title}: no draft yet. ${g.reply || 'Ask me for this email on its own.'}`
  if (g.note === 'events_off') return `⏸ ${g.title}: event planning isn’t switched on for you yet.`
  if (g.note === 'capability_off') return `⏸ ${g.title}: reminders are switched off in your settings, so I did not set it.`
  if (g.note === 'event_not_started') return `⏸ ${g.title}: I could not start this one from the list. Send it on its own, like: *plan an event: ${clip(g.slots.topic, 60).replace(/[*_~`]/g, '')} on ${g.slots.date}${g.slots.time ? ` at ${g.slots.time}` : ''}*.`
  return `⏸ ${g.title}: I couldn’t start this one. Ask me about it on its own.`
}

const ICON: Record<string, string> = { completed: '✅', waiting_approval: '📝', failed: '⚠️', outcome_unknown: '❓' }
/** What to say right after "get it done": what started, what is waiting and why. Results follow as they finish. */
export function startedText(plan: IntakePlan, quick: Map<string, { status: string; text: string }>, surface?: 'whatsapp' | 'web'): string {
  const live = plan.goals.filter(g => g.state !== 'dropped')
  const go = live.filter(g => g.state === 'started')
  const lines = [`Started ${go.length} of ${live.length}.`, '']
  for (const g of live) {
    const q = g.runId ? quick.get(g.runId) : undefined
    if (g.state === 'started' && g.note === 'early') lines.push(`▶️ ${g.title}: already under way from before.`)
    else if (g.state === 'started') lines.push(q ? `${ICON[q.status] || '⏳'} ${g.title}: ${q.text.length > 300 ? 'done, details below.' : clip(q.text, 300)}` : `⏳ ${g.title}: working on it.`)
    else if (g.state === 'open') lines.push(`⏸ ${g.title}: not started. I still need ${missingOf(g).map(s => question(g, s).replace(/\?$/, '')).join(', ')}. Ask me for this one on its own when you have it.`)
    else lines.push(heldLine(g))
  }
  lines.push('', surface === 'web' ? 'You can leave this page; I’ll keep going. Each result appears here in the chat and on your Tasks page. I won’t send a WhatsApp message for each result.' : 'You can close WhatsApp; I’ll keep going and message you as each one finishes. Everything is on your Tasks page too.')
  return lines.join('\n')
}

export function newPlan(text: string, goals: IntakeGoal[], now: Date): IntakePlan {
  return { v: 1, id: createHash('sha256').update(`${now.toISOString()}:${text}`).digest('hex').slice(0, 24), at: now.toISOString(), text: clip(text, 2000), goals }
}
/** A stored plan, checked from scratch; too old or malformed is no plan. */
export function readPlan(raw: unknown, now: Date): IntakePlan | null {
  const p = raw as any
  if (!p || p.v !== 1 || typeof p.id !== 'string' || !/^[0-9a-f]{24}$/.test(p.id) || !Array.isArray(p.goals) || !p.goals.length || p.goals.length > MAX_GOALS) return null
  const at = Date.parse(String(p.at || ''))
  if (!Number.isFinite(at) || at > now.getTime() + 60_000 || now.getTime() - at > PLAN_MINUTES * 60_000 || p.started) return null
  const goals: IntakeGoal[] = []
  for (const g of p.goals) {
    if (!g || typeof g.id !== 'string' || !/^g\d{1,2}$/.test(g.id) || !(KINDS as readonly string[]).includes(g.kind)) return null
    const slots: Slots = {}
    // Re-checked like a fresh answer (dates may be any day from the plan's own day on).
    for (const s of SLOTS) { const v = typeof g.slots?.[s] === 'string' ? slotValue(s, g.slots[s], String(p.at).slice(0, 10)) : null; if (v) slots[s] = v }
    goals.push({ id: g.id, kind: g.kind, title: clip(g.title, 60), words: clip(g.words, 200), slots, ownership: OWNER_OF[g.kind as GoalKind],
      asked: (Array.isArray(g.asked) ? g.asked : []).filter((s: any) => (SLOTS as readonly string[]).includes(s)), state: ['open', 'started', 'held', 'dropped'].includes(g.state) ? g.state : 'open', runId: typeof g.runId === 'string' ? g.runId : undefined, note: typeof g.note === 'string' ? g.note : undefined })
  }
  return { v: 1, id: p.id, at: p.at, text: clip(p.text, 2000), goals, strays: Number.isInteger(p.strays) && p.strays >= 0 ? Math.min(p.strays, 9) : 0 }
}

const STATE_KEY = 'goal_intake_plan'
export type Store = { load: (tg: number) => Promise<unknown>; save: (tg: number, plan: IntakePlan) => Promise<void>; clear: (tg: number) => Promise<void> }
const realStore: Store = {
  load: async tg => { const fs = await import('@/lib/bot/handlers/followup-state'); return (await fs.getLatestFollowupState(tg, STATE_KEY))?.payload?.plan ?? null },
  save: async (tg, plan) => { const fs = await import('@/lib/bot/handlers/followup-state'); await fs.clearFollowupState(tg, STATE_KEY); await fs.saveFollowupState(tg, STATE_KEY, { plan, created_at: new Date().toISOString() }) },
  clear: async tg => { const fs = await import('@/lib/bot/handlers/followup-state'); await fs.clearFollowupState(tg, STATE_KEY) },
}
// The one way a plan starts: these exact phrases, alone or at the end of the reply that gives the missing details.
// Bare "yes", "go ahead", "do it" and "start" belong to other flows (an approval, an Events confirmation) and never
// start a plan; the model's opinion of whether the person meant "start" is not used.
const START_CLAUSE = /^(?:(?:ok(?:ay)?|yes|yep|alright|great|cool|perfect|sure|go\s+ahead|now|please|pls|plz)[\s,.!]+)*(?:(?:please|pls|plz|just)\s+)?(?:get\s+(?:it|them|these|this|everything|all\s+of\s+them)\s+(?:all\s+)?done|start\s+(?:them|these)(?:\s+all)?|do\s+(?:them|these)(?:\s+all)?)(?:[\s,]+(?:please|pls|plz|now|thanks|thank\s+you|na|yaar))*[\s.!*\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F]*$/iu
// Anything that could turn the phrase into "not yet", "I will" or a question: then it is not a start.
const NOT_A_START = /\b(?:don'?t|do\s+not|not|never|no|nope|wait|hold|stop|cancel|i'?ll|i\s+will|i\s+can|let\s+me|should|shall|could|would|can\s+you|will\s+you|later|yet|before|after|unless|until|if|when|how|why)\b|\?/i
/** True only when the message is the start phrase, or ends with it as its own clause after the details, and nothing
 *  in the message negates, defers or questions it. */
export function wantsStartPhrase(text: string): boolean {
  const t = String(text || '').replace(/[‘’]/g, "'").replace(/\*/g, '').trim()
  if (!t || t.length > 600 || NOT_A_START.test(t)) return false
  if (START_CLAUSE.test(t)) return true
  const last = t.split(/[,.;!\n]+/).map(s => s.trim()).filter(Boolean).pop() || ''
  return last !== t && START_CLAUSE.test(last)
}
/** A bare confirmation meant for whatever asked last (an approval card, Events' "are you sure?"): never the plan's. */
const BARE_CONFIRM = /^\s*(?:yes|yes please|yeah|yep|ok|okay|sure|confirm|confirmed|go ahead|do it|start|no|nope|cancel)\b[\s,.!]*(?:(?:cancel|move)(?: it)?)?[\s.!]*$/i

export type IntakeDeps = { model?: Model; store?: Store; start?: StartDeps; now?: Date; timezone?: string; surface?: 'whatsapp' | 'web';
  /** Start in the first reply. Default: goalEarlyStartEnabledFor(owner). */
  early?: boolean; calendar?: (actor: AgentActor, date: string) => Promise<CalendarDay>; background?: (work: () => Promise<void>) => void; send?: (text: string) => Promise<void>; /** How long the first reply waits for quick results (default 8 s). */ quickMs?: number }

/** The WhatsApp entry. Returns the reply, or null when the message is not a list and not a reply to a pending plan
 *  (routing then continues exactly as before). Never throws. */
/** The calendar for one day, as "HH:MM" local times. All-day entries and anything that is not on that day are left
 *  out. `ok` false means the calendar could not be read (not connected, incomplete): then nothing is assumed. */
/** Pure: one day's meetings from the calendar step's output, or ok false when that output is not a full read. */
export function calendarDayFrom(output: any, date: string, fallbackTz: string): CalendarDay {
  const o = output || {}
  // Partial page, unreadable account, or more entries than were returned: not verified, so nothing is assumed.
  if (o.mode !== 'read' || o.complete !== true || (Number(o.entryCount) || 0) > (Array.isArray(o.events) ? o.events.length : 0)) return { ok: false, events: [] }
  const tz = String(o.timezone || fallbackTz)
  const parts = (ms: number) => { const p: Record<string, string> = {}; for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))) p[x.type] = x.value; return p }
  const events: CalendarDay['events'] = []
  let skipped = 0
  for (const e of o.events) {
    const start = String(e?.start || ''), title = clip(e?.summary, 80)
    if (!/T/.test(start)) continue // all day
    const at = Date.parse(start), end = Date.parse(String(e?.end || ''))
    if (!Number.isFinite(at)) continue
    // Declined, marked free, or a block that is not a meeting: no reminder.
    const declined = Array.isArray(e?.attendees) && e.attendees.some((x: any) => x?.self === true && x?.responseStatus === 'declined')
    if (declined || e?.transparency === 'transparent' || !title || NOT_A_MEETING.test(title)) { skipped++; continue }
    const p = parts(at)
    let day = `${p.year}-${p.month}-${p.day}`
    // A series entered as one entry spanning weeks (seen on the owner's calendar, 20 and 27 Oct): it happens daily at
    // its start time, so it counts on this day at that time.
    if (day < date && Number.isFinite(end) && end - at > 36 * 3600_000) { const q = parts(end); if (`${q.year}-${q.month}-${q.day}` >= date) day = date }
    if (day !== date) continue
    events.push({ title, time: `${p.hour}:${p.minute}` })
  }
  return { ok: true, events, skipped }
}
const realCalendar = async (actor: AgentActor, date: string): Promise<CalendarDay> => {
  // The canonical read-only step, called directly so that nothing is remembered as "selected": a hidden look-up must
  // not make the person's next "it" or "that one" mean a calendar event (11 Nov review).
  const { executeReadOnlyCalendarStep } = await import('./calendar-read')
  const r: any = await Promise.race([
    executeReadOnlyCalendarStep({ actor, instruction: `Show my calendar on ${date}`, missionText: `Show my calendar on ${date}`, rememberSelection: false }),
    new Promise((_, no) => setTimeout(() => no(new Error('calendar_timeout')), 10_000)),
  ])
  return calendarDayFrom(r?.output, date, actor.timezone || 'Asia/Kolkata')
}
const clock12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` }
const minus = (t: string, mins: number) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m - mins; return x < 0 ? null : `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}` }
export const REMIND_BEFORE_MINUTES = 10, MAX_CALENDAR_REMINDERS = 5

/** "Remind me about my meeting(s) tomorrow": the day's meetings are read from the calendar and a reminder is set 10
 *  minutes before each (one per start time, at most five). Nothing is guessed: with no calendar, an unreadable one, no
 *  meeting that day, or one meeting asked about and several found, the goal stays open and the reply asks. Looked up once
 *  per plan. Returns the line for the reply, or null when the goal is left to be asked about. */
async function remindFromCalendar(actor: AgentActor, g: IntakeGoal, plan: IntakePlan, deps: IntakeDeps, now: Date): Promise<string | null> {
  if (g.kind !== 'reminder' || g.state !== 'open' || !g.slots.date || g.slots.time || g.note || !meetingReminderWords(g.words)) return null
  const sd = deps.start || {}
  if (await (sd.capabilityOff || realCapabilityOff)(actor, 'reminders')) return null
  const day = await (deps.calendar || realCalendar)(actor, g.slots.date).catch(() => ({ ok: false, events: [] } as CalendarDay))
  g.note = 'calendar_checked'
  if (!day.ok) return null
  const nowLocal = localNow(actor.timezone || 'Asia/Kolkata', now)
  const byTime = new Map<string, string[]>()
  // Meetings named in their words ("my call with Nithin") are the ones meant.
  const words = g.words.toLowerCase()
  const named = day.events.filter(e => e.title.length >= 4 && words.includes(e.title.toLowerCase()))
  for (const e of [...(named.length ? named : day.events)].filter(e => TIME.test(e.time)).sort((a, b) => a.time.localeCompare(b.time))) byTime.set(e.time, [...(byTime.get(e.time) || []), clip(e.title, 80)])
  const ahead = [...byTime.entries()].map(([time, titles]) => ({ time, titles, at: minus(time, REMIND_BEFORE_MINUTES) })).filter(x => x.at && `${g.slots.date}T${x.at}` > nowLocal)
  if (!ahead.length) { g.note = 'calendar_empty'; return null }
  const list = (xs: typeof ahead) => xs.map(x => `${x.titles.join(' and ')} at ${clock12(x.time)}`).join('; ')
  // One meeting asked about ("my meeting"), several found, none named: ask which instead of setting them all.
  if (!named.length && ahead.length > 1 && !PLURAL_MEETINGS.test(g.words)) { g.note = `calendar_pick:${clip(list(ahead.slice(0, 5)), 300)}`; return null }
  const slots = ahead.slice(0, MAX_CALENDAR_REMINDERS), more = ahead.length - slots.length
  const date = g.slots.date
  const set: string[] = [], pending: string[] = [], failed: string[] = []
  let created = 0
  await Promise.all(slots.map(async x => {
    const message = clip(`${x.titles.join(' and ')} at ${clock12(x.time)}`, 200)
    let run: { runId: string; drive: () => Promise<{ status: string; text: string }> }
    try {
      run = await (sd.startRun || realStartRun)({ actor, goal: g, plan, surface: sd.surface || deps.surface,
        step: { tool: 'reminders', title: 'Set reminder', instruction: `Remind me on ${date} at ${clock12(x.at!)}: ${message}`, reminder: { date, time: x.at!, message } } })
    } catch { failed.push(clock12(x.at!)); return }
    created++; g.runId = g.runId || run.runId
    const driving = run.drive().catch(() => ({ status: 'failed', text: '' }))
    const r = await Promise.race([driving, new Promise<{ status: string; text: string }>(res => setTimeout(() => res({ status: 'running', text: '' }), deps.quickMs ?? 8000))])
    if (r.status === 'completed') set.push(clock12(x.at!))
    else if (r.status === 'running') {
      pending.push(clock12(x.at!))
      // Still being written when the reply goes: confirmed (or not) in its own message.
      if (deps.background && deps.send) deps.background(async () => { const f = await driving; await deps.send!(f.status === 'completed' ? `⏰ Reminder set for ${clock12(x.at!)}: ${message}.` : `⚠️ I could not set the ${clock12(x.at!)} reminder for ${message}. Tell me the time and I'll try again.`) })
    } else failed.push(clock12(x.at!))
  }))
  // Nothing was created at all: the goal goes back to being asked about.
  if (!created) { g.note = 'calendar_checked'; return null }
  g.state = 'started'; g.note = 'early'
  const when = detailOf({ ...g, slots: { date } }).replace(/^for /, '')
  return [`${when}: you have ${list(slots)}.`,
    set.length ? `Reminders set for ${set.join(' and ')}, ${REMIND_BEFORE_MINUTES} minutes before.` : '',
    pending.length ? `Still setting ${pending.join(' and ')}; I'll confirm in a moment.` : '',
    failed.length ? `I could not set the reminder for ${failed.join(' and ')}.` : '',
    more > 0 ? `${more} later meeting${more === 1 ? '' : 's'} that day ${more === 1 ? 'has' : 'have'} no reminder; ask me if you want one.` : '',
    'Say *my reminders* to see or change them.'].filter(Boolean).join(' ')
}

/** After goals start: a few seconds for the quick ones; the rest report in the background. */
async function collectStarted(res: { started: Started[] }, deps: IntakeDeps): Promise<{ quick: Map<string, { status: string; text: string }>; replies: string[] }> {
  const quick = new Map<string, { status: string; text: string }>()
  // A few seconds for the quick ones (a reminder is written and read back at once); the rest go on in the
  // background and each sends its own message when it finishes. Each run was already set going as it was created.
  const driven = res.started.filter(s => s.running).map(s => ({ s, p: s.running! }))
  await Promise.race([Promise.allSettled(driven.map(async d => { const r = await d.p; quick.set(d.s.goal.runId!, r) })), new Promise(r => setTimeout(r, deps.quickMs ?? 8000))])
  const later = driven.filter(d => !quick.has(d.s.goal.runId!))
  if (later.length && deps.background && deps.send) deps.background(async () => { await Promise.allSettled(later.map(async d => { const r = await d.p; await deps.send!(`*${d.s.goal.title}*\n${block(r.text, 3000)}`) })) })
  const replies = [
    ...res.started.filter(s => s.reply).map(s => `*${s.goal.title}*\n${block(s.reply, 1500)}`),
    // A result that arrived in time but is too long for its line in the summary is given whole.
    ...res.started.filter(s => s.goal.runId && (quick.get(s.goal.runId)?.text.length || 0) > 300).map(s => `*${s.goal.title}*\n${block(quick.get(s.goal.runId!)!.text, 3000)}`),
  ]
  return { quick, replies }
}

/** The first reply when some goals could start at once: what is already moving, then what still needs a word. */
export function earlyText(plan: IntakePlan, moving: { goal: IntakeGoal; line: string }[], rest: string): string {
  const total = plan.goals.filter(g => g.state !== 'dropped').length, open = plan.goals.filter(g => g.state === 'open').length
  const held = plan.goals.filter(g => g.state === 'held')
  const lines = [`On it. ${moving.length} of ${total} ${moving.length === 1 ? 'is' : 'are'} already moving:`, ...moving.map(m => `• ${m.goal.title}: ${m.line}`), ...(held.length ? ['', ...held.map(heldLine)] : [])]
  if (open) lines.push('', `${open === 1 ? 'One is' : `${open} are`} waiting on you:`, ...rest.split('\n').slice(2))
  else lines.push('', held.length ? 'Nothing else is waiting on you.' : 'Nothing else needs you. Anything that needs your yes will still ask first.')
  return lines.join('\n')
}

/** Looks before asking, and starts what needs no answer. Returns the reply, or null when nothing could start (the
 *  caller then shows the plan as before). The plan is saved, with the goals marked started, before anything starts. */
async function earlyStart(actor: AgentActor, plan: IntakePlan, deps: IntakeDeps, store: Store, now: Date): Promise<{ text?: string; replies: string[]; plan: IntakePlan } | null> {
  const tg = actor.legacyTelegramId
  const goals = plan.goals.map(g => ({ ...g, slots: { ...g.slots }, asked: [...g.asked] }))
  const work: IntakePlan = { ...plan, goals }
  // At most two calendar look-ups per message, each once per plan.
  const calendarGoals = goals.filter(g => g.kind === 'reminder' && g.state === 'open' && g.slots.date && !g.slots.time && !g.note && meetingReminderWords(g.words)).slice(0, 2)
  const ready = goals.filter(g => g.state === 'open' && !missingOf(g).length && EARLY_KINDS.includes(g.kind))
  if (!calendarGoals.length && !ready.length) return null
  // Marked before anything starts, so a repeated message or a retry cannot start the same goals twice.
  const readyIds = new Set(ready.map(g => g.id)), marked = new Set([...ready, ...calendarGoals].map(g => g.id))
  try { await store.save(tg, { ...work, goals: goals.map(g => marked.has(g.id) ? { ...g, state: 'started' as const, note: 'early' } : g) }) } catch { return null }
  const moving: { goal: IntakeGoal; line: string }[] = []
  for (const g of calendarGoals) { const line = await remindFromCalendar(actor, g, work, deps, now).catch(() => null); if (line) moving.push({ goal: g, line }) }
  const res = ready.length ? await startGoals(actor, work, { ...(deps.start || {}), surface: deps.start?.surface || deps.surface, now, only: g => readyIds.has(g.id) }) : { plan: work, started: [] as Started[] }
  const { quick, replies } = await collectStarted(res, deps)
  const after = res.plan.goals
  for (const g of after) {
    if (!readyIds.has(g.id)) continue
    if (g.state === 'started') { g.note = 'early'; const q = g.runId ? quick.get(g.runId) : undefined; moving.push({ goal: g, line: q ? `${q.status === 'completed' ? '' : `${ICON[q.status] || '⚠️'} `}${q.text.length > 300 ? 'done, details below.' : clip(q.text, 300)}` : 'working on it; I’ll message you when it’s ready.' }) }
  }
  const next: IntakePlan = { ...work, goals: after }
  // A goal that could not start (switched off, time passed) stays held with its reason, said in the reply; it is not
  // retried on every later message.
  if (!moving.length) return { replies: [], plan: next }
  const rest = planText(next)
  const kept = rest.plan.goals.some(g => g.state === 'open')
  await (kept ? store.save(tg, rest.plan) : store.clear(tg)).catch((e: any) => console.error('GOAL_INTAKE_FAILED:', JSON.stringify({ code: `early_save_${String(e?.message || 'error').replace(/[^a-z0-9_]/gi, '').slice(0, 30)}` })))
  console.log('GOAL_INTAKE:', JSON.stringify({ step: 'early', goals: next.goals.length, moving: moving.length }))
  return { text: earlyText(rest.plan, moving, rest.text), replies, plan: rest.plan }
}

/** Is a plan from this person still waiting for details or for "get it done"? While one is, their next message is
 *  offered to the plan before a reply to an older alert is read into it ("Skip the emails. Get it done" is about the
 *  plan, not an instruction to drop the last alert). Never throws; false when intake is off for them. */
export async function hasOpenGoalPlan(actor: AgentActor, deps: { store?: Store; now?: Date } = {}): Promise<boolean> {
  try {
    if (!goalIntakeEnabledFor(String(actor.legacyTelegramId))) return false
    const plan = readPlan(await (deps.store || realStore).load(actor.legacyTelegramId), deps.now || new Date())
    return Boolean(plan)
  } catch { return false }
}

export async function tryGoalIntake(actor: AgentActor, text: string, deps: IntakeDeps = {}): Promise<string | null> {
  let planWasOpen = false
  const tg = actor.legacyTelegramId, owner = String(tg)
  if (!goalIntakeEnabledFor(owner)) return null
  const now = deps.now || new Date()
  let tz = deps.timezone || actor.timezone || 'Asia/Kolkata'
  const day = (zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  let today: string
  try { today = day(tz) } catch { tz = 'Asia/Kolkata'; today = day(tz) }
  const model = deps.model || realModel, store = deps.store || realStore
  const earlyOn = deps.early ?? goalEarlyStartEnabledFor(owner)
  try {
    const pending = readPlan(await store.load(tg).catch(() => null), now)
    if (pending) {
      if (BARE_CONFIRM.test(text)) return null
      planWasOpen = true
      const wantsStart = wantsStartPhrase(text), onlyStart = wantsStart && START_CLAUSE.test(text.replace(/\*/g, '').trim())
      const ans = onlyStart ? { about_plan: true, start: true } : await model.answers({ text, today, timezone: tz, goals: pending.goals.filter(g => g.state === 'open').map(g => ({ id: g.id, kind: g.kind, title: g.title, missing: missingOf(g) })) })
      const applied = applyAnswers(pending, wantsStart && ans ? { ...ans, about_plan: true } : ans, today)
      // Details given together with the start phrase: the phrase decides, whatever the model made of the rest.
      // The phrase alone starts the plan. The phrase after other words starts it only when those words gave at least
      // one detail (or dropped a goal) for this plan: "nahi, get it done" or "send Divya the docs, get it done" gave
      // none, so the plan is shown again instead.
      const changed = JSON.stringify(applied.plan.goals.map(g => [g.slots, g.state])) !== JSON.stringify(pending.goals.map(g => [g.slots, g.state]))
      const plan = applied.plan, about = applied.about || wantsStart, start = onlyStart || (wantsStart && changed)
      if (about) {
        if (!start) {
          const early = earlyOn ? await earlyStart(actor, plan, deps, store, now) : null
          if (early?.text) return [early.text, ...early.replies].join('\n\n')
          const out = planText(early?.plan || plan); await store.save(tg, out.plan); console.log('GOAL_INTAKE:', JSON.stringify({ step: 'answers', goals: plan.goals.length })); return out.text
        }
        // Marked started before anything starts: a stored plan marked started is never read again (readPlan), so a
        // repeated "get it done", a retry or a failed clean-up cannot start it twice. Not saved: nothing starts.
        try { await store.save(tg, { ...plan, started: now.toISOString() }) } catch { return 'I couldn’t start these just now. Say *get it done* again in a moment.' }
        const res = await startGoals(actor, plan, { ...(deps.start || {}), surface: deps.start?.surface || deps.surface, now })
        await store.clear(tg).catch(() => {})
        const { quick, replies } = await collectStarted(res, deps)
        console.log('GOAL_INTAKE:', JSON.stringify({ step: 'start', goals: plan.goals.length, started: res.started.length }))
        return [startedText(res.plan, quick, deps.surface), ...replies].join('\n\n')
      }
      // Not about the plan: it stays open for one more message, then is dropped, so a later "go ahead" meant for
      // something else cannot start it.
      if ((pending.strays || 0) >= 1) await store.clear(tg); else await store.save(tg, { ...pending, strays: 1 })
    }
    if (!looksLikeGoalList(text)) return null
    const goals = goalsFrom(await model.list({ text, today, timezone: tz }), today)
    if (!goals.length) return null
    const early = earlyOn ? await earlyStart(actor, newPlan(text, goals, now), deps, store, now) : null
    if (early?.text) return [early.text, ...early.replies].join('\n\n')
    const out = planText(early?.plan || newPlan(text, goals, now))
    await store.save(tg, out.plan)
    console.log('GOAL_INTAKE:', JSON.stringify({ step: 'plan', goals: goals.length, kinds: goals.map(g => g.kind) }))
    return out.text
  } catch (err: any) {
    console.error('GOAL_INTAKE_FAILED:', JSON.stringify({ code: String(err?.message || 'error').replace(/[^a-z0-9_:]/gi, '').slice(0, 60) }))
    // With a plan open, a message that asks to start it is not passed on to be read as something else; nothing was
    // started or changed, and the plan is still there.
    if (planWasOpen && wantsStartPhrase(text)) return 'I couldn’t read that just now, so nothing has started and your plan is unchanged. Please send it once more.'
    return null
  }
}
