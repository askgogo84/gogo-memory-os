// Context-first brain (docs/brain/README.md). One model call reads the conversation, the open topic and the
// user's saved context BEFORE any keyword rule sees the message, then either answers, asks one question, or
// hands Gogo's existing capabilities a self-contained instruction (pronouns resolved, details kept).
// 27 Oct: "Did it land?" after tracking QF67 was answered "Marked done: it land?" by a to-do keyword rule. The
// owner asked for a conversational assistant that understands the full context before replying.
//
// Safety: the brain never approves, pays, books, sends or changes accounts. It only chooses what to say or how
// to phrase the request for the existing handlers, which keep every approval and Sentinel check. Short replies
// that answer an approval or a numbered pick bypass it entirely, and any failure falls back to today's pipeline.
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type BrainDecision =
  | { kind: 'reply'; text: string }
  | { kind: 'ask'; text: string }
  | { kind: 'handle'; instruction: string; rewritten: boolean }
  | { kind: 'flight'; flightNo: string; track: boolean }
  | { kind: 'later'; question: string }
  | { kind: 'skip'; reason: string }

export type BrainTurn = { role: 'user' | 'assistant'; content: string; createdAt?: string | null }
export type BrainContext = {
  turns: BrainTurn[]
  trackedFlights: string[]
  sections: Record<string, string[]>
  name?: string | null
  timezone: string
}

const MODEL = () => process.env.GOGO_BRAIN_MODEL || 'claude-sonnet-4-5'
const TIMEOUT_MS = 8_000
// 27 Oct live: one decision took 16.9 s because the SDK silently retried after a slow first attempt. No retries:
// a slow brain falls back to today's pipeline instead of making the person wait.
const MAX_RETRIES = 0
const clean = (v: unknown, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10)

/** Canary: on for GOGO_BRAIN_USERS (default: the owner's two test numbers); GOGO_BRAIN=off turns it off for everyone. */
const OWNER_CANARY = '8884501501,8310441698'
export function brainEnabledFor(phone: string, env: Record<string, string | undefined> = process.env): boolean {
  if (String(env.GOGO_BRAIN || '').toLowerCase() === 'off') return false
  // The owner default applies on production only, so tests and previews stay on today's pipeline unless set.
  const list = String(env.GOGO_BRAIN_USERS || (env.VERCEL_ENV === 'production' ? OWNER_CANARY : ''))
  const me = digits(phone)
  return !!me && list.split(',').map(digits).filter(Boolean).includes(me)
}

// Exact commands keep their deterministic handlers: approvals, yes/no, numbered picks, STOP, OTPs, buttons.
const EXACT = /^\s*(?:yes|y|yeah|yep|yup|no|n|nope|ok|okay|sure|approve[d]?|reject|deny|decline|confirm|cancel|stop|start|unsubscribe|help|done|snooze(?:\s+\d+\s*m(?:in(?:utes?)?)?)?|book|book\s+(?:it|1|2|3|this|that)|haan|ha|nahi|mr|mrs|ms|miss|master)\s*[.!]*\s*$|^\s*#?\d{1,6}\s*$|^\s*(?:option\s*)?[1-9](?:st|nd|rd|th)?\s*$/i
export function isExactCommand(text: string): boolean {
  const t = String(text || '').trim()
  return !t || EXACT.test(t) || /^(?:admin|\/)\S*/i.test(t)
}

export const BRAIN_SYSTEM = (ctx: BrainContext, now: Date) => `You are the understanding layer of AskGogo, a WhatsApp personal assistant for ${clean(ctx.name, 40) || 'the user'}.
Current time: ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: ctx.timezone }).format(now)} (${ctx.timezone}).

Read the WHOLE conversation and the user's context below before deciding. The latest message is usually a follow-up: "it", "that", "the flight", "book", "the second one", "what about tomorrow" refer to what was just discussed. Never decide from a single keyword.

Choose exactly one tool:
- flight: the message is about a flight's status, landing, delay or take-off (including "did it land?" about a flight being tracked or just discussed), or asks to track one. Give the flight number.
- reply: you can fully answer from the conversation and context alone (chat, thanks, a question about something already said, advice). Be warm, brief, WhatsApp-style. Never claim you did, saved, booked, set or sent anything. Never use reply for anything live (a flight's status, prices, weather, news, availability): earlier messages may be stale, so use flight or handle.
- ask: the request is genuinely ambiguous even with context. One short question.
- later: the user asks about the results of a search Gogo is still running (an open travel or flight search in Open tasks, results not yet shown). Gogo will answer it the moment the results arrive, so do not ask them anything.
- handle: anything that needs Gogo's tools (reminders, lists, expenses, email, calendar, documents, web answers, prices, shopping, restaurants, travel search and booking, watches, memory). Write the instruction the way the user would say it if they had been fully explicit: resolve "it/that/this" to the named thing (flight number, date, product, person), keep every detail the user gave, add nothing they did not ask for. If the message is already explicit, or it answers a question Gogo just asked (a name, a choice, details for a booking), set keep_original true. To book or pick an option from a numbered list Gogo already showed (flights, hotels, products), the instruction is exactly "book <number>" (or "pick <number>") using that list's number: never restate the route, date or airline, because that starts a new search.

Hard rules: never approve, confirm, pay or accept anything on the user's behalf; never add words like yes, approve, confirm or pay to an instruction; never invent facts, prices or statuses.

USER CONTEXT (owner-bound, may be partial):
${Object.entries(ctx.sections).filter(([, v]) => v.length).map(([k, v]) => `${k}:\n${v.map(x => `- ${x}`).join('\n')}`).join('\n') || '(none)'}
${ctx.trackedFlights.length ? `\nFlights being tracked now or in the last 12 h: ${ctx.trackedFlights.join(', ')}` : ''}`

export const BRAIN_TOOLS: Anthropic.Tool[] = [
  { name: 'flight', description: 'Live status of a flight, or start tracking it.', input_schema: { type: 'object', properties: { flight_no: { type: 'string', description: 'IATA flight number, e.g. QF1' }, track: { type: 'boolean', description: 'true when the user asks to track/monitor/alert on it' } }, required: ['flight_no', 'track'] } },
  { name: 'reply', description: 'Answer directly from the conversation and context.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'ask', description: 'Ask one short clarifying question.', input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'later', description: 'Answer this question about a running search once its results arrive.', input_schema: { type: 'object', properties: { question: { type: 'string', description: 'The question, self-contained' } }, required: ['question'] } },
  { name: 'handle', description: "Hand the request to Gogo's capabilities.", input_schema: { type: 'object', properties: { instruction: { type: 'string', description: 'Self-contained request in the user\'s voice' }, keep_original: { type: 'boolean' } }, required: ['instruction', 'keep_original'] } },
]

const CONSENT = /\b(?:approve[ds]?|confirm(?:ed|s)?|pay|payment|accept|authori[sz]e|yes)\b/i

/** Validates the model's tool call into a decision. Pure. */
export function decisionFromToolUse(original: string, name: string, input: any): BrainDecision {
  if (name === 'flight') {
    const code = clean(input?.flight_no, 12).toUpperCase().replace(/\s+/g, '')
    if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(code)) return { kind: 'handle', instruction: original, rewritten: false }
    return { kind: 'flight', flightNo: code, track: input?.track === true }
  }
  if (name === 'reply' || name === 'ask') {
    const text = clean(name === 'reply' ? input?.text : input?.question, 1500)
    return text ? { kind: name, text } : { kind: 'skip', reason: 'empty_text' }
  }
  if (name === 'handle') {
    const instruction = clean(input?.instruction, 600)
    // A rewrite may never introduce consent words the user did not write.
    if (input?.keep_original === true || !instruction || (CONSENT.test(instruction) && !CONSENT.test(original))) return { kind: 'handle', instruction: original, rewritten: false }
    return { kind: 'handle', instruction, rewritten: instruction !== original.trim() }
  }
  if (name === 'later') {
    const question = clean(input?.question, 400) || clean(original, 400)
    return { kind: 'later', question }
  }
  return { kind: 'skip', reason: `unknown_tool:${name}` }
}

export async function loadBrainContext(p: { telegramId: number; text: string; name?: string | null; timezone?: string | null; userId?: string; whatsappId?: string }, now = new Date()): Promise<BrainContext> {
  const timezone = clean(p.timezone || 'Asia/Kolkata', 60)
  const [convo, flights, ctx] = await Promise.all([
    supabaseAdmin.from('conversations').select('role,content,created_at').eq('telegram_id', p.telegramId)
      .order('created_at', { ascending: false }).order('role', { ascending: true }).limit(20).then(r => r.data || [], () => []),
    supabaseAdmin.from('agent_watchers').select('condition_json,active,updated_at').eq('telegram_id', String(p.telegramId)).not('condition_json->adHocFlight', 'is', null)
      .or(`active.eq.true,updated_at.gte.${new Date(now.getTime() - 12 * 3600_000).toISOString()}`).order('updated_at', { ascending: false }).limit(5).then(r => r.data || [], () => []),
    import('./understanding-context').then(m => m.buildUnderstandingContext({ actor: { legacyTelegramId: p.telegramId, name: p.name, timezone, userId: p.userId, whatsappId: p.whatsappId }, text: p.text, now, timezone, skip: ['recent_turns'] })).catch(() => null),
  ])
  const turns = (convo as any[]).filter(r => r.role === 'user' || r.role === 'assistant').reverse()
    .map(r => ({ role: r.role, content: clean(r.content, 900), createdAt: r.created_at || null })) as BrainTurn[]
  const line = (i: any) => [clean(i.title, 160), i.detail ? clean(i.detail, 60) : '', i.at ? clean(i.at, 50) : ''].filter(Boolean).join(' · ')
  const sections: Record<string, string[]> = ctx ? {
    'Open tasks': ctx.openTasks.map(line), 'Pending approvals': ctx.pendingApprovals.map(line), 'Active watches': ctx.watches.map(line),
    'Upcoming reminders': ctx.upcomingReminders.map(line), 'Travel': ctx.travelLegs.map(line), 'Calendar (today/tomorrow)': ctx.calendarEvents.map(line),
    'Saved documents and tickets': ctx.savedAssetsIndex.map(line), 'Standing preferences': ctx.preferences.map(x => clean(x, 160)), 'Relevant memories': ctx.memoryFacts.map(line),
  } : {}
  const trackedFlights = [...new Set((flights as any[]).map(w => {
    const f = w.condition_json?.adHocFlight || {}
    return f.flightNo ? `${f.flightNo}${f.from && f.to ? ` (${f.from} → ${f.to})` : ''}${w.active ? '' : ' [tracking ended]'}` : ''
  }).filter(Boolean))]
  return { turns, trackedFlights, sections, name: p.name, timezone }
}

/** Merges consecutive same-role turns so the Messages API sees strict alternation ending in the new user turn. */
export function brainMessages(turns: BrainTurn[], text: string): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (const t of [...turns, { role: 'user' as const, content: text }]) {
    const c = clean(t.content, 900)
    if (!c) continue
    const last = out[out.length - 1]
    if (last && last.role === t.role) last.content = `${last.content}\n${c}`
    else out.push({ role: t.role, content: c })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

export async function decide(p: { text: string; ctx: BrainContext; now?: Date; client?: Pick<Anthropic, 'messages'> }): Promise<BrainDecision & { ms: number }> {
  const t0 = Date.now()
  try {
    const client = p.client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const res: any = await client.messages.create({
      model: MODEL(), max_tokens: 700, system: BRAIN_SYSTEM(p.ctx, p.now || new Date()),
      tools: BRAIN_TOOLS, tool_choice: { type: 'any' }, messages: brainMessages(p.ctx.turns, p.text),
    }, { timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES })
    const use = (res.content || []).find((b: any) => b.type === 'tool_use')
    const d = use ? decisionFromToolUse(p.text, use.name, use.input) : { kind: 'skip' as const, reason: 'no_tool_use' }
    return { ...d, ms: Date.now() - t0 }
  } catch (err: any) {
    return { kind: 'skip', reason: `error:${clean(err?.message || err, 120)}`, ms: Date.now() - t0 }
  }
}

/** Live flight answer for the flight tool: status (+ tracking when asked), from the flight feed only. */
export async function flightAnswer(telegramId: number, flightNo: string, track: boolean, timezone: string): Promise<string | null> {
  const m = await import('./flight-track')
  const live = await m.lookupLiveFlight(flightNo, new Date(), timezone, undefined, { telegramId: String(telegramId) }).catch(() => null)
  if (!live) return null
  const answer = m.conversationalFlightAnswer(live, timezone)
  if (!track || live.status.state === 'landed' || live.status.state === 'cancelled') return answer.replace(/ I'll message you[^.]*\./, '')
  const watch = await m.createFlightTrackWatch(String(telegramId), live).catch(() => null)
  return watch ? `${answer.replace(/ I'll message you[^.]*\./, '')}\n\n✅ Tracking ${live.flightNo}. I'll message you on any delay, gate change, take-off and the moment it lands.` : answer
}

/**
 * The single entry the surfaces call. Returns a reply to send, a rewritten text to continue with, or null to
 * continue unchanged. Never throws.
 */
// 28 Oct live: Gogo asked "Is that Mr, Ms or Mrs?", the person replied "Mr", and the brain rewrote it to "book 3".
// A short or multi-line reply right after Gogo asked something is an answer to that question: the handler that
// asked it owns the reply, so the brain leaves the text unchanged.
const ASKED = /\?\s*$|\?\s*\n|\breply with\b|\bsend (?:these|just|me)\b|\breply \*?yes\*?\b/i
export function answersGogosQuestion(turns: BrainTurn[], text: string, now = Date.now()): boolean {
  const last = turns[turns.length - 1]
  if (!last || last.role !== 'assistant' || !ASKED.test(String(last.content || ''))) return false
  const at = Date.parse(String(last.createdAt || ''))
  if (Number.isFinite(at) && now - at > 30 * 60_000) return false
  const t = String(text || '').trim()
  return t.includes('\n') || t.split(/\s+/).length <= 4
}

export async function runBrain(p: { phone: string; telegramId: number; text: string; name?: string | null; timezone?: string | null; userId?: string; whatsappId?: string; surface: 'whatsapp' | 'web' }): Promise<{ reply?: string; text?: string } | null> {
  if (!brainEnabledFor(p.phone) || isExactCommand(p.text)) return null
  const ctx = await loadBrainContext(p).catch(() => null)
  if (!ctx) return null
  if (answersGogosQuestion(ctx.turns, p.text)) { console.log('BRAIN_DECISION:', JSON.stringify({ surface: p.surface, kind: 'skip', reason: 'answers_question' })); return null }
  const d = await decide({ text: p.text, ctx })
  console.log('BRAIN_DECISION:', JSON.stringify({ surface: p.surface, kind: d.kind, ms: d.ms, model: MODEL(), turns: ctx.turns.length, flights: ctx.trackedFlights.length,
    ...(d.kind === 'handle' ? { rewritten: d.rewritten, instruction: d.rewritten ? d.instruction.slice(0, 200) : undefined } : {}), ...(d.kind === 'flight' ? { flightNo: d.flightNo, track: d.track } : {}), ...(d.kind === 'skip' ? { reason: d.reason } : {}) }))
  if (d.kind === 'reply' || d.kind === 'ask') return { reply: d.text }
  if (d.kind === 'flight') {
    const answer = await flightAnswer(p.telegramId, d.flightNo, d.track, ctx.timezone).catch(() => null)
    return answer ? { reply: answer } : { text: `${d.track ? 'Track' : 'Status of'} flight ${d.flightNo}` }
  }
  if (d.kind === 'later') {
    const saved = await saveFollowup(p.telegramId, d.question).catch(() => false)
    if (saved) return { reply: `Still searching. I'll answer that the moment the results are in.` }
    return null
  }
  if (d.kind === 'handle' && d.rewritten) return { text: d.instruction }
  return null
}

// ---------------------------------------------------------------- questions asked while a search runs
// 27 Oct live: "Which one is cheapest in the morning?" asked mid-search got an odd question back and was never
// answered when the results landed. The question is kept as a step on the running search (its own row, so it
// can never overwrite the run's results) and answered right after the results are delivered.
const FOLLOWUP_TOOL = 'user_followup'

export async function saveFollowup(telegramId: number, question: string, now = new Date()): Promise<boolean> {
  const { data: run } = await supabaseAdmin.from('agent_runs').select('id').eq('telegram_id', String(telegramId)).eq('type', 'travel_research')
    .in('status', ['queued', 'running']).gte('updated_at', new Date(now.getTime() - 30 * 60_000).toISOString()).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (!run?.id) return false
  for (const ordinal of [97, 98, 99]) {
    const { error } = await supabaseAdmin.from('agent_steps').insert({ telegram_id: String(telegramId), run_id: run.id, ordinal, tool_name: FOLLOWUP_TOOL,
      title: 'Question asked while searching', status: 'completed', input_json: { question: clean(question, 400) }, output_json: { answered: false }, completed_at: now.toISOString() })
    if (!error) return true
  }
  return false
}

/** After a search's results are delivered: answer each question asked meanwhile, from the fresh conversation. */
export async function answerFollowups(p: { runId: string; telegramId: number; send: (text: string) => Promise<unknown>; client?: Pick<Anthropic, 'messages'> }): Promise<number> {
  const { data: steps } = await supabaseAdmin.from('agent_steps').select('id,input_json,output_json').eq('run_id', p.runId).eq('telegram_id', String(p.telegramId)).eq('tool_name', FOLLOWUP_TOOL).order('ordinal', { ascending: true })
  const open = (steps || []).filter((s: any) => s?.output_json?.answered !== true && clean(s?.input_json?.question))
  let answered = 0
  for (const step of open) {
    const question = clean(step.input_json.question, 400)
    // Mark first so a retry of the delivery never answers twice.
    const { error } = await supabaseAdmin.from('agent_steps').update({ output_json: { answered: true } }).eq('id', step.id).eq('telegram_id', String(p.telegramId))
    if (error) continue
    try {
      const ctx = await loadBrainContext({ telegramId: p.telegramId, text: question })
      const client = p.client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      const res: any = await client.messages.create({
        model: MODEL(), max_tokens: 500, system: `${BRAIN_SYSTEM(ctx, new Date())}\n\nThe search results were just sent (latest assistant message). Answer the user's earlier question from those results only. Be brief, name the option number, airline, time and fare.`,
        tools: BRAIN_TOOLS.filter(t => t.name === 'reply'), tool_choice: { type: 'tool', name: 'reply' }, messages: brainMessages(ctx.turns, `(Earlier, while you were searching, I asked:) ${question}`),
      }, { timeout: TIMEOUT_MS * 2, maxRetries: 1 })
      const text = clean((res.content || []).find((b: any) => b.type === 'tool_use')?.input?.text, 1200)
      if (!text) continue
      await p.send(text)
      await supabaseAdmin.from('conversations').insert({ telegram_id: p.telegramId, role: 'assistant', content: text })
      answered++
    } catch (err: any) { console.error('BRAIN_FOLLOWUP_FAILED:', clean(err?.message || err, 120)) }
  }
  if (open.length) console.log('BRAIN_FOLLOWUPS:', JSON.stringify({ runId: p.runId, open: open.length, answered }))
  return answered
}
