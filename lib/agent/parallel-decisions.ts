// Parallel Decisions shadow trial (3 Nov, owner approved): ask Parallel the same public question Gogo already answers
// and log whether the two agree, how long it took and what it cost. Log only — the answer never reaches a user, never
// changes a reply, alert or watcher. Only public facts go out (a flight number, its date and airports); never a
// user's email, calendar, memories, contacts, name or phone. Off without PARALLEL_API_KEY; PARALLEL_SHADOW=off stops it.
// API: POST https://api.parallel.ai/v1/decisions { state, questions, mode? } → { answers, citations, usage, decision_id }.

export const PARALLEL_DECISIONS_URL = 'https://api.parallel.ai/v1/decisions'
/** $1 per 1,000 calls (first 5,000 free): 0.1 rupee-paise is not a unit, so log USD. */
export const PARALLEL_USD_PER_CALL = 0.001

export type DecisionQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }

export type DecisionAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number> }
  | { type: 'score'; score: number; probabilities: Record<string, number> }
  | { type: 'refusal' }
  | { type: 'invalid' }

export type DecisionResult = { ok: true; answers: Record<string, DecisionAnswer>; citations: string[]; decisionId?: string; ms: number }
  | { ok: false; reason: string; ms: number }

/** Anything that looks private: an email address, a phone-length digit run or a long free-text field. */
const PRIVATE_SHAPE = /[^\s@]+@[^\s@]+\.[a-z]{2,}|\d{9,}/i

/** Public facts only: flat string/number fields, short, nothing shaped like an email or phone. Throws otherwise. */
export function assertPublicState(state: Record<string, unknown>) {
  for (const [k, v] of Object.entries(state)) {
    if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`parallel_state_not_flat:${k}`)
    const s = String(v)
    if (s.length > 120) throw new Error(`parallel_state_too_long:${k}`)
    if (PRIVATE_SHAPE.test(s)) throw new Error(`parallel_state_private_shape:${k}`)
  }
}

export function buildDecisionRequest(state: Record<string, string | number>, questions: Record<string, DecisionQuestion>, mode: 'fast' | 'default' = 'fast') {
  assertPublicState(state)
  const n = Object.keys(questions).length
  if (n < 1 || n > 100) throw new Error('parallel_question_count')
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === 'choice' && (Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 255)) throw new Error(`parallel_choice_options:${name}`)
    if (q.type === 'score' && (q.criteria.length < 2 || q.criteria.length > 10)) throw new Error(`parallel_score_levels:${name}`)
  }
  return { state, questions, ...(mode === 'fast' ? { mode: 'fast' } : {}) }
}

function parseAnswer(a: any, q?: DecisionQuestion): DecisionAnswer {
  if (!a || typeof a !== 'object') return { type: 'invalid' }
  if (a.type === 'refusal') return { type: 'refusal' }
  if (a.type === 'noul' && typeof a.noul === 'number' && a.noul >= 0 && a.noul <= 1) return { type: 'noul', noul: a.noul }
  if (a.type === 'choice' && typeof a.choice === 'string' && (!q || q.type !== 'choice' || a.choice in q.criteria))
    return { type: 'choice', choice: a.choice, probabilities: a.probabilities && typeof a.probabilities === 'object' ? a.probabilities : {} }
  if (a.type === 'score' && typeof a.score === 'number') return { type: 'score', score: a.score, probabilities: a.probabilities || {} }
  return { type: 'invalid' }
}

/** Reads a Decisions response; an unknown choice or malformed answer is `invalid`, a refusal stays a refusal. */
export function parseDecisionResponse(body: any, questions: Record<string, DecisionQuestion>) {
  const answers: Record<string, DecisionAnswer> = {}
  for (const name of Object.keys(questions)) answers[name] = parseAnswer(body?.answers?.[name], questions[name])
  const citations = (Array.isArray(body?.citations) ? body.citations : []).map((c: any) => String(c?.url || '')).filter((u: string) => /^https:\/\//.test(u)).slice(0, 5)
  return { answers, citations, decisionId: typeof body?.decision_id === 'string' ? body.decision_id : undefined }
}

export function parallelShadowEnabled(env: Record<string, string | undefined> = (globalThis as any).process?.env || {}) {
  return Boolean(env.PARALLEL_API_KEY) && String(env.PARALLEL_SHADOW || '').toLowerCase() !== 'off'
}

type Fetch = (url: string, init: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>

export async function callParallelDecisions(state: Record<string, string | number>, questions: Record<string, DecisionQuestion>,
  opts: { timeoutMs?: number; fetcher?: Fetch; env?: Record<string, string | undefined> } = {}): Promise<DecisionResult> {
  const env = opts.env || (globalThis as any).process?.env || {}
  const started = Date.now()
  if (!parallelShadowEnabled(env)) return { ok: false, reason: 'disabled', ms: 0 }
  let body: any
  try { body = buildDecisionRequest(state, questions) } catch (e: any) { return { ok: false, reason: String(e?.message || e), ms: 0 } }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000)
  try {
    const res = await (opts.fetcher || (fetch as unknown as Fetch))(PARALLEL_DECISIONS_URL, {
      method: 'POST', headers: { 'x-api-key': String(env.PARALLEL_API_KEY), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    })
    if (!res.ok) return { ok: false, reason: `http_${res.status}`, ms: Date.now() - started }
    return { ok: true, ...parseDecisionResponse(await res.json(), questions), ms: Date.now() - started }
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'network', ms: Date.now() - started }
  } finally { clearTimeout(timer) }
}

// ── Flight status shadow ─────────────────────────────────────────────────────────────────────────────────────────
export const FLIGHT_STATE_CRITERIA: Record<string, string> = {
  landed: 'The flight has landed at its destination on this date.',
  airborne: 'The flight has departed and is in the air now.',
  not_departed: 'The flight has not departed yet (scheduled, boarding or delayed on the ground).',
  cancelled: 'The flight on this date was cancelled.',
  diverted: 'The flight was diverted to a different airport.',
  unknown: 'The evidence does not establish the current status of this flight on this date.',
}

/** Gogo's states → the shadow's choices, so agreement is like for like. */
export function gogoFlightChoice(state: string | undefined): string {
  switch (state) {
    case 'landed': return 'landed'
    case 'departed': return 'airborne'
    case 'scheduled': case 'delayed': return 'not_departed'
    case 'cancelled': return 'cancelled'
    case 'diverted': return 'diverted'
    default: return 'unknown'
  }
}

const FLIGHT_NO = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/
const IATA = /^[A-Z]{3}$/

/** Public flight facts only. Returns null (no call) when the flight number or date is not clean. */
export function flightShadowState(f: { flightNo: string; departAt: string; fromIata?: string; toIata?: string }) {
  const flightNo = String(f.flightNo || '').replace(/\s+/g, '').toUpperCase()
  const t = Date.parse(String(f.departAt || ''))
  if (!FLIGHT_NO.test(flightNo) || !Number.isFinite(t)) return null
  const state: Record<string, string> = { flight_number: flightNo, departure_date_utc: new Date(t).toISOString().slice(0, 10) }
  if (f.fromIata && IATA.test(f.fromIata)) state.from_airport = f.fromIata
  if (f.toIata && IATA.test(f.toIata)) state.to_airport = f.toIata
  return state
}

export type ShadowLog = { kind: 'flight_status'; gogo: string; parallel: string; agree: boolean | null; confidence?: number; ms: number; usd: number; reason?: string; citations?: number }

/** One shadow comparison; logs `PARALLEL_SHADOW` and returns the record. Never throws, never alters anything. */
export async function shadowFlightStatus(f: { flightNo: string; departAt: string; fromIata?: string; toIata?: string; gogoState?: string; now?: Date },
  opts: { fetcher?: Fetch; env?: Record<string, string | undefined>; log?: (line: string) => void } = {}): Promise<ShadowLog | null> {
  try {
    const state = flightShadowState(f)
    if (!state) return null
    const gogo = gogoFlightChoice(f.gogoState)
    const questions = { status: { type: 'choice' as const, instructions: `What is the current status of flight ${state.flight_number} departing on ${state.departure_date_utc} (UTC date)${(f.now ? `, as of ${f.now.toISOString().slice(0, 16)}Z` : '')}? Pick unknown if the evidence is insufficient.`, criteria: FLIGHT_STATE_CRITERIA } }
    const r = await callParallelDecisions(state, questions, opts)
    const failure = 'reason' in r ? r.reason : undefined
    if (failure === 'disabled') return null
    const a = r.ok ? r.answers.status : undefined
    const parallel = !r.ok ? 'error' : a?.type === 'choice' ? a.choice : a?.type || 'invalid'
    const comparable = a?.type === 'choice' && parallel !== 'unknown' && gogo !== 'unknown'
    const rec: ShadowLog = {
      kind: 'flight_status', gogo, parallel, agree: comparable ? parallel === gogo : null,
      ...(a?.type === 'choice' ? { confidence: Math.round(Number(a.probabilities[a.choice] || 0) * 100) / 100 } : {}),
      ms: r.ms, usd: r.ok ? PARALLEL_USD_PER_CALL : 0, ...(r.ok ? { citations: r.citations.length } : { reason: failure }),
    }
    ;(opts.log || ((l: string) => console.log(l)))(`PARALLEL_SHADOW ${JSON.stringify(rec)}`)
    return rec
  } catch { return null }
}
