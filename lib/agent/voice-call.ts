// Phone calls through Bolna (voice agent) + Plivo (+91 number). Approved mock: "Online booking blocked: offer a call"
// (docs/architecture/08-booking-engine.md, P6). Rules:
//   - Gogo only calls after the person's explicit yes to a call plan that shows the number, the script and the limits.
//   - The agent says it is an AI assistant first, never pays, shares card details or agrees to a deposit.
//   - The result is reported honestly from the transcript; "booked" only when the venue said yes on the call.
//   - No automatic redial loop: the person can say "call again" (at most 2 redials per plan).
import { supabaseAdmin } from '@/lib/supabase-admin'

const BOLNA = 'https://api.bolna.ai'
export const CALL_AGENT_NAME = 'AskGogo booking caller v2'
export const DEFAULT_FROM_NUMBER = '+918065539020'
export const PLAN_STATE = 'voice_call_plan'
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

/** "Call District 6 and book a table for 2 Saturday 8pm", "test call me", "yes call", "call again". Pure. */
export function parseCallCommand(raw: string): CallCommand | null {
  const t = String(raw || '').trim()
  const test = t.match(/^(?:(?:do\s+a\s+)?test\s+call(?:\s+me)?|call\s+me\s+(?:to|for\s+a)\s+test|make\s+a\s+test\s+call)(?:\s+(?:on|at|to)\s+([+\d][\d\s-]{8,16}))?[.!]?$/i)
  if (test) { const n = test[1] ? indianPhoneFrom(test[1]) : null; return n ? { kind: 'test', number: n } : { kind: 'test' } }
  if (/^(?:yes[,!]?\s*)?(?:(?:please\s+)?(?:go\s+ahead\s+and\s+)?call(?:\s+them|\s+now)?|place\s+the\s+call|yes,?\s*call)[.!]?$/i.test(t) && /\bcall\b/i.test(t) && !/\bagain\b/i.test(t)) return { kind: 'approve' }
  // A bare yes only approves when Gogo's latest message is the call plan (checked in tryVoiceCall).
  if (/^(?:yes|yeah|yep|yup|ok|okay|sure|go\s+ahead|do\s+it|please\s+do|haan|ha)(?:\s+please)?[.!]*$/i.test(t)) return { kind: 'affirm' }
  if (/^(?:please\s+)?(?:call|try)\s+(?:them\s+)?again[.!]?$|^redial[.!]?$/i.test(t)) return { kind: 'redial' }
  if (/^(?:no|don'?t\s+call|do\s+not\s+call|cancel\s+(?:the\s+)?call)[.!]?$/i.test(t)) return { kind: 'decline' }
  if (/^(?:please\s+)?(?:call|phone|ring)\s+(?!me\b)(?:up\s+)?.{2,80}?\s+(?:and|to)\s+(?:book|reserve)\b/i.test(t)) return { kind: 'book', text: t }
  return null
}

export type CallPlan = {
  venue: string; to: string; source: string; guestName: string; partySize: number | null
  date: string | null; dateLabel: string; timeLabel: string; flexWindow: string; seating: string
  purpose: string; test: boolean; redials: number; createdAt: string; startClock?: string
}

/** The approved mock's call-plan card as WhatsApp text. Pure. */
export function callPlanText(p: CallPlan) {
  const script = p.test
    ? `"Hi, I'm an AI assistant from AskGogo, calling for ${p.guestName}. This is a short test call so you can hear how I sound."`
    : `"Hi, I'm an AI assistant from AskGogo, calling for ${p.guestName}. Could I book a table for ${p.partySize || 2} ${p.dateLabel} at ${p.timeLabel}? If that's full, ${p.flexWindow} works."`
  const body = [
    '*CALL PLAN · NEEDS YOUR YES*',
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
    return { booked: o.booked === true, confirmedTime: typeof o.confirmed_time === 'string' && o.confirmed_time ? o.confirmed_time : null,
      staffName: typeof o.staff_name === 'string' && o.staff_name ? o.staff_name.slice(0, 40) : null,
      callbackAt: typeof o.callback_time === 'string' && o.callback_time ? o.callback_time.slice(0, 40) : null,
      notes: String(o.notes || '').slice(0, 300) }
  } catch { return null }
}

const FAIL_STATUS: Record<string, string> = { 'no-answer': "nobody picked up", busy: 'the line was busy', failed: "the call didn't connect", canceled: 'the call was cancelled', stopped: 'the call was stopped', error: "the call didn't connect", 'balance-low': 'the calling balance is too low (top up Bolna/Plivo)' }
export const TERMINAL = new Set(['completed', ...Object.keys(FAIL_STATUS)])

/** What the person reads after the call. Pure. */
export function callResultText(p: CallPlan, status: string, outcome: CallOutcome | null, transcriptTail = '', saved = false) {
  const head = `📞 ${p.venue}`
  if (status !== 'completed') return `${head}: ${FAIL_STATUS[status] || "the call didn't complete"}. Nothing was booked.${p.test ? '' : p.redials < MAX_REDIALS ? '\nSay *call again* to retry.' : ''}`
  if (p.test) return `${head}: test call finished. Tell me how it sounded, and say *call District 6…* style requests when you're ready.`
  if (!outcome) return `${head}: the call finished, but I couldn't read a clear answer from it, so I'm not treating it as booked.${transcriptTail ? `\nLast words on the call: "${transcriptTail}"` : ''}`
  if (outcome.booked) {
    // 21 Oct live: the notes line repeated the confirmation ("Reservation for 2 … confirmed under Goverdhan").
    return [`*Booked by phone* · ${p.dateLabel.replace(/^on\s+/i, '')}, ${outcome.confirmedTime || p.timeLabel}, ${p.partySize || 2} guests, under ${p.guestName}.`,
      outcome.staffName ? `Confirmed by ${outcome.staffName} on the call.` : 'Confirmed by the restaurant on the call.',
      saved ? 'Saved to My bookings, with a reminder 2 hours before.' : '',
      'This is a phone confirmation, not a written booking ID.'].filter(Boolean).join('\n')
  }
  return [`${head}: not booked. ${outcome.notes || 'They did not confirm a table.'}`,
    outcome.callbackAt ? `They asked to be called back ${outcome.callbackAt}.` : '',
    p.redials < MAX_REDIALS ? 'Say *call again* to retry.' : ''].filter(Boolean).join('\n')
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
  if (!res.ok) throw new Error(`bolna_${res.status}:${String(data?.message || text).slice(0, 160)}`)
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
- Before ending, repeat the final details back (day, time, people, name) and ask for the staff member's name.
- End politely once the booking is confirmed or refused.`

let cachedAgentId: string | null = null
/** Find the AskGogo caller agent by name, or create it once. */
export async function ensureCallAgent(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cachedAgentId) return cachedAgentId
  if (process.env.BOLNA_AGENT_ID) return (cachedAgentId = process.env.BOLNA_AGENT_ID)
  const all = await bolna('/v2/agent/all', {}, fetchImpl)
  const found = (Array.isArray(all) ? all : []).find((a: any) => a?.agent_name === CALL_AGENT_NAME && a?.id)
  if (found) return (cachedAgentId = String(found.id))
  const created = await bolna('/v2/agent', { method: 'POST', body: {
    agent_config: {
      agent_name: CALL_AGENT_NAME,
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
    agent_prompts: { task_1: { system_prompt: CALL_AGENT_PROMPT } },
  } }, fetchImpl)
  const id = String(created?.agent_id || '')
  if (!id) throw new Error('bolna_agent_create_failed')
  return (cachedAgentId = id)
}

export async function placeCall(plan: CallPlan, contactNumber: string, fetchImpl: typeof fetch = fetch) {
  const agentId = await ensureCallAgent(fetchImpl)
  const res = await bolna('/call', { method: 'POST', body: {
    agent_id: agentId,
    recipient_phone_number: plan.to,
    from_phone_number: String(process.env.BOLNA_FROM_NUMBER || DEFAULT_FROM_NUMBER),
    user_data: {
      venue: plan.venue, guest_name: plan.guestName, party_size: String(plan.partySize || 2), date_label: plan.dateLabel,
      time_label: plan.timeLabel, flex_window: plan.flexWindow, seating: plan.seating, contact_number: contactNumber,
      purpose: plan.purpose, timezone: 'Asia/Kolkata',
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

export async function tryVoiceCall(params: { actor: Actor; text: string; surface: 'web' | 'whatsapp' }): Promise<Reply | null> {
  const cmd = parseCallCommand(params.text)
  if (!cmd) return null
  const tg = params.actor.legacyTelegramId
  const fs = await import('@/lib/bot/handlers/followup-state')
  if (cmd.kind === 'affirm') {
    // 21 Oct live: "Yes" to the plan fell through to chat, which claimed it was calling. A bare yes right
    // after the plan is the approval; anywhere else it belongs to some other question.
    if (!(await latestAssistantText(tg)).includes('CALL PLAN')) return null
  }
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
    if (!voiceCallsEnabled()) return { text: 'Calling isn\'t switched on yet (the voice provider key is missing). Nothing was called.', handledBy: 'voice-call' }
    const contact = params.actor.whatsappId ? '+' + String(params.actor.whatsappId).replace(/\D/g, '') : ''
    let executionId: string
    try { executionId = await placeCall(plan, contact) } catch (err: any) {
      console.error('VOICE_CALL_PLACE_FAILED:', String(err?.message || err).slice(0, 200))
      return { text: `I couldn't place the call to ${plan.venue} just now${/balance|402|insufficient/i.test(String(err?.message)) ? ' (the calling balance looks low)' : ''}. Nothing was called or booked.`, handledBy: 'voice-call' }
    }
    const at = new Date().toISOString()
    await supabaseAdmin.from('agent_runs').insert({
      telegram_id: String(tg), type: 'voice_call', capability: 'contacts', status: 'running', progress: 20,
      title: `Call · ${plan.venue}`, summary: `Calling ${plan.venue} (${displayPhone(plan.to)}).`, source: params.surface,
      why: 'You approved this call plan.', metadata_json: { plan_type: 'voice_call', plan, execution_id: executionId }, started_at: at, updated_at: at,
    })
    await fs.saveFollowupState(tg, PLAN_STATE, { plan })
    return { text: `📞 Calling ${plan.venue} now from ${displayPhone(String(process.env.BOLNA_FROM_NUMBER || DEFAULT_FROM_NUMBER))}. I'll message you here with what they said, usually within 2–3 minutes.`, handledBy: 'voice-call' }
  }

  // "…under the name Goverdhan" wins; otherwise the account name.
  const named = params.text.match(/\bunder\s+(?:the\s+name\s+(?:of\s+)?)?([A-Z][A-Za-z.'-]{1,30}(?:\s+[A-Z][A-Za-z.'-]{1,30})?)/)
  const guestName = named?.[1] || String(params.actor.name || 'my client').split(/\s+/)[0]
  const now = new Date().toISOString()
  let plan: CallPlan
  if (cmd.kind === 'test') {
    const own = cmd.number || indianPhoneFrom(String(params.actor.whatsappId || ''))
    if (!own) return { text: "I don't have an Indian mobile number for you to test-call.", handledBy: 'voice-call' }
    plan = { venue: 'your phone', to: own, source: cmd.number ? 'the number you gave' : 'your WhatsApp number', guestName, partySize: null, date: null, dateLabel: 'today', timeLabel: 'now', flexWindow: 'n/a', seating: 'n/a',
      purpose: 'This is a short test call. Say hello, explain you are testing how you sound for future restaurant bookings, ask if the audio is clear, then thank them and end.', test: true, redials: 0, createdAt: now }
  } else {
    const rr = await import('@/lib/agent/restaurant-reservation')
    // "Call District 6 near Orion mall and book a table for 2 Saturday 8pm" -> "Book a table for 2 Saturday 8pm at District 6 near Orion mall"
    const parts = cmd.text.replace(/\s+under\s+(?:the\s+name\s+(?:of\s+)?)?[A-Z][A-Za-z.' -]{1,40}$/, '').match(/^(?:please\s+)?(?:call|phone|ring)\s+(?:up\s+)?(.+?)\s+(?:and|to)\s+(?:book|reserve)\s+(.+)$/i)
    const venuePart = parts ? parts[1].replace(/\s+(?:on|at|via)\s+[+\d][\d\s-]{8,16}$/i, '').trim() : ''
    const bookingText = parts ? `Book ${parts[2].trim()} at ${venuePart}` : cmd.text
    const intent = rr.parseRestaurantReservationIntent(bookingText)
    if (!intent?.restaurant) return { text: 'Which restaurant should I call, and for when? For example: *call District 6 and book a table for 2 Saturday 8pm*.', handledBy: 'voice-call' }
    const explicit = indianPhoneFrom(cmd.text)
    const area = (cmd.text.match(/\bnear\s+([a-z0-9 .'-]{2,40}?)(?:\s+(?:for|on|at|this|tomorrow|today)\b|$)/i)?.[1] || '').trim()
    const previous: any = await fs.getLatestFollowupState(tg, PLAN_STATE).catch(() => null)
    const remembered = previous?.payload?.plan?.venue && String(previous.payload.plan.venue).toLowerCase() === intent.restaurant.toLowerCase() && !previous.payload.plan.test ? { phone: String(previous.payload.plan.to), source: String(previous.payload.plan.source || 'from your last plan') } : null
    const found = explicit ? { phone: explicit, source: 'the number you gave' } : (await findVenuePhone(intent.restaurant, area)) || remembered
    if (!found) return { text: `I couldn't find a phone number for ${intent.restaurant}. Send it, like *call ${intent.restaurant} on 080 1234 5678 and book a table…*. Nothing was called.`, handledBy: 'voice-call' }
    const start = intent.preferredStart || '20:00'
    const window = flexWindowLabel(start, rr.reservationClockLabel)
    plan = { venue: intent.restaurant, to: found.phone, source: found.source, guestName, partySize: intent.partySize || 2, date: intent.requestedDate || null,
      dateLabel: intent.requestedDate ? rr.reservationDayLabel(intent.requestedDate, start) : 'today', timeLabel: rr.reservationClockLabel(start),
      flexWindow: window, seating: /smok/i.test(cmd.text) ? (/non[\s-]?smok/i.test(cmd.text) ? 'non-smoking' : 'smoking') : 'no preference',
      purpose: `Book a table for ${intent.partySize || 2} people at ${intent.restaurant}.`, test: false, redials: 0, createdAt: now, startClock: start }
  }
  await fs.saveFollowupState(tg, PLAN_STATE, { plan })
  return { text: callPlanText(plan), handledBy: 'voice-call-plan' }
}

// ---- cron: read finished calls and report ----------------------------------------------------------------------

/** A venue's yes on the call becomes a booking in My bookings plus a 2-hour reminder (approved mock). */
async function recordPhoneBooking(telegramId: string, executionId: string, plan: CallPlan, outcome: CallOutcome): Promise<boolean> {
  const startAt = bookedStartAt(plan, outcome)
  if (!startAt) return false
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('life_events').upsert({
    telegram_id: telegramId, event_type: 'reservation', subtype: 'phone_booking', source: 'voice_call',
    title: `Table at ${plan.venue} · ${plan.partySize || 2} guests (phone booking)`.slice(0, 240), provider: 'phone',
    start_at: startAt, end_at: new Date(Date.parse(startAt) + 90 * 60_000).toISOString(), timezone: 'Asia/Kolkata', location: null,
    lifecycle_state: 'planned', participants: [],
    preferences_json: { partySize: plan.partySize, guestName: plan.guestName, seating: plan.seating },
    metadata_json: { restaurant: plan.venue, phone: plan.to, bookingStatus: 'confirmed_by_phone', confirmedBy: outcome.staffName, executionId },
    source_refs: [], dedupe_key: `voice_call:${executionId}`, updated_at: now,
  }, { onConflict: 'telegram_id,dedupe_key' })
  if (error) throw new Error(error.message)
  const remindAt = Date.parse(startAt) - 2 * 3600_000
  if (remindAt > Date.now()) {
    await supabaseAdmin.from('reminders').insert({ telegram_id: Number(telegramId), chat_id: Number(telegramId), message: `Table at ${plan.venue} in 2 hours (${plan.partySize || 2} guests, under ${plan.guestName}).`, remind_at: new Date(remindAt).toISOString(), sent: false, timezone: 'Asia/Kolkata' })
  }
  return true
}

export async function processVoiceCalls(deps: { send: (to: string, text: string) => Promise<any> }) {
  const { data: runs } = await supabaseAdmin.from('agent_runs').select('id,telegram_id,metadata_json,started_at').eq('type', 'voice_call').eq('status', 'running').limit(10)
  let done = 0
  for (const run of (runs || []) as any[]) {
    const meta = run.metadata_json || {}
    const plan: CallPlan = meta.plan
    let exec: any
    try { exec = await getExecution(String(meta.execution_id)) } catch (err: any) { console.error('VOICE_CALL_READ_FAILED:', run.id, String(err?.message || err).slice(0, 160)); continue }
    const status = String(exec?.status || '')
    const tooOld = Date.now() - Date.parse(String(run.started_at)) > 20 * 60_000
    if (!TERMINAL.has(status) && !tooOld) continue
    const transcript = String(exec?.transcript || '')
    let outcome: CallOutcome | null = null
    if (status === 'completed' && transcript && !plan.test) {
      // 21 Oct live: Mercury spent its whole 300-token budget on reasoning and returned nothing, so a finished
      // call read as "couldn't read a clear answer". Claude Haiku reads it; Mercury (bigger budget) is the fallback.
      const prompt = `Read this restaurant booking phone call transcript. Reply with JSON only: {"booked": true only if the restaurant clearly confirmed a table, "confirmed_time": "8:00 pm" or null, "staff_name": name or null, "callback_time": when they asked to be called back or null, "notes": one short plain sentence on what happened}.\nRequested: table for ${plan.partySize} ${plan.dateLabel} at ${plan.timeLabel}.\nTranscript:\n${transcript.slice(-6000)}`
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
    let saved = false
    if (status === 'completed' && outcome?.booked && !plan.test) saved = await recordPhoneBooking(String(run.telegram_id), String(meta.execution_id), plan, outcome).catch((err: any) => { console.error('VOICE_CALL_RECORD_FAILED:', run.id, String(err?.message || err).slice(0, 160)); return false })
    const text = callResultText(plan, TERMINAL.has(status) ? status : 'failed', outcome, transcript.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 160) || '', saved)
    const at = new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({ status: status === 'completed' ? 'completed' : 'failed', progress: 100, summary: text.slice(0, 500), completed_at: at, updated_at: at,
      metadata_json: { ...meta, final_status: status, outcome, recording_url: exec?.telephony_data?.recording_url || null } }).eq('id', run.id).eq('status', 'running')
    const { data: user } = await supabaseAdmin.from('users').select('whatsapp_id').eq('telegram_id', Number(run.telegram_id)).maybeSingle()
    try { if (user?.whatsapp_id) await deps.send(String(user.whatsapp_id), text) } catch {}
    await supabaseAdmin.from('conversations').insert({ telegram_id: Number(run.telegram_id), role: 'assistant', content: text })
    done++
  }
  return done
}
