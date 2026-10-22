// Usage metering: who each paid call served, and what it cost.
// Pure helpers (no Supabase import) so they can be tested offline. The writer lives in ./record.ts.
import { AsyncLocalStorage } from 'node:async_hooks'

export type TaskTrace = { runId: string; stepId?: string; attempt?: number; decisionId?: string; approvalId?: string }
export type MeterContext = { telegramId: string; surface?: string } & Partial<TaskTrace>
export type MeterEvent = {
  vendor: string
  category: string
  model?: string | null
  units?: number
  inputTokens?: number | null
  outputTokens?: number | null
  cachedReadTokens?: number | null
  cachedWriteTokens?: number | null
  inputIncludesCached?: boolean
  ok?: boolean
  metadata?: Record<string, unknown>
}
export type RateCard = Record<string, { usd?: number | null; inr?: number | null }>

const store: AsyncLocalStorage<MeterContext> = (globalThis as any).__askgogoMeterStore || new AsyncLocalStorage<MeterContext>()
;(globalThis as any).__askgogoMeterStore = store

/** Attribute every metered call from here on (in this request) to this person. */
export function meterAs(telegramId: string | number | null | undefined, surface?: string) {
  const id = telegramId == null || telegramId === '' ? '' : String(telegramId)
  if (!id) return
  try { const parent = store.getStore(); store.enterWith({ ...(parent?.telegramId === id ? parent : {}), telegramId: id, surface: surface || (parent?.telegramId === id ? parent.surface : undefined) }) } catch { /* never break a request over metering */ }
}
export function runMeteredAs<T>(telegramId: string | number, fn: () => T, surface?: string): T {
  const parent = store.getStore(), owner = String(telegramId)
  return store.run({ ...(parent?.telegramId === owner ? parent : {}), telegramId: owner, surface: surface || (parent?.telegramId === owner ? parent.surface : undefined) }, fn)
}
export function currentMeterContext(): MeterContext | null { return store.getStore() || null }

/** One isolated trace per actual tool attempt; no shared mutable request globals. */
export function runMeteredTask<T>(telegramId: string | number, trace: TaskTrace, work: () => T): T {
  const owner = String(telegramId), parent = store.getStore()
  const clean = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_:-]{1,128}$/.test(v) ? v : undefined
  const runId = clean(trace.runId)
  if (!runId) throw new Error('meter_task_identity_invalid')
  return store.run({ telegramId: owner, surface: parent?.telegramId === owner ? parent.surface : undefined,
    runId, stepId: clean(trace.stepId), decisionId: clean(trace.decisionId), approvalId: clean(trace.approvalId),
    attempt: Number.isSafeInteger(trace.attempt) && trace.attempt! >= 0 ? trace.attempt : undefined }, work)
}

// Seed values mirror supabase/migrations/20261021150000_admin_console_v1.sql (estimates; the table wins).
export const DEFAULT_RATES: RateCard = {
  'fx.usd_inr': { inr: 88 },
  'anthropic.haiku.input': { usd: 1 }, 'anthropic.haiku.output': { usd: 5 },
  'anthropic.sonnet.input': { usd: 3 }, 'anthropic.sonnet.output': { usd: 15 },
  'anthropic.opus.input': { usd: 5 }, 'anthropic.opus.output': { usd: 25 },
  'openai.mini.input': { usd: 0.4 }, 'openai.mini.output': { usd: 1.6 },
  'openai.default.input': { usd: 2.5 }, 'openai.default.output': { usd: 10 },
  'inception.mercury.input': { usd: 0.25 }, 'inception.mercury.output': { usd: 1 },
  'tavily.search': { usd: 0.008 }, 'serper.search': { usd: 0.001 },
  'bolna.call': { usd: 0.1 }, 'browserbase.session': { usd: 0.05 }, 'assemblyai.transcript': { usd: 0.02 },
  'twilio.whatsapp.outbound': { inr: 0.35 }, 'resend.email': { usd: 0 },
}

/** Which rate-card family a model name belongs to. */
export function modelFamily(vendor: string, model: string | null | undefined): string {
  const m = String(model || '').toLowerCase()
  if (vendor === 'anthropic') return m.includes('opus') ? 'anthropic.opus' : m.includes('sonnet') ? 'anthropic.sonnet' : 'anthropic.haiku'
  if (vendor === 'inception') return 'inception.mercury'
  if (vendor === 'openai') return /mini|nano/.test(m) ? 'openai.mini' : 'openai.default'
  return vendor
}

/** Price one event in rupees (and dollars when the rate is in dollars). Unknown rates price at 0. */
export function priceEvent(e: MeterEvent, rates: RateCard): { inr: number; usd: number | null } {
  const fx = Number(rates['fx.usd_inr']?.inr ?? DEFAULT_RATES['fx.usd_inr'].inr) || 88
  const toInr = (usd: number) => usd * fx
  if (e.category === 'llm') {
    const fam = modelFamily(e.vendor, e.model)
    const i = rates[`${fam}.input`]?.usd, o = rates[`${fam}.output`]?.usd
    const usd = ((e.inputTokens || 0) * Number(i || 0) + (e.outputTokens || 0) * Number(o || 0)) / 1e6
    return { inr: round4(toInr(usd)), usd: round6(usd) }
  }
  const key = `${e.vendor}.${e.category}`
  const r = rates[key]
  const units = Number(e.units ?? 1)
  if (r?.inr != null) return { inr: round4(Number(r.inr) * units), usd: null }
  if (r?.usd != null) { const usd = Number(r.usd) * units; return { inr: round4(toInr(usd)), usd: round6(usd) } }
  return { inr: 0, usd: null }
}
const round4 = (n: number) => Math.round(n * 1e4) / 1e4
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Map an outbound HTTP request to a metered event kind, or null when it is not a paid call we track. */
export function classifyRequest(url: string, method: string): { vendor: string; category: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase(), path = u.pathname, post = method.toUpperCase() === 'POST'
  if (!post) return null
  if (host === 'api.anthropic.com' && path.startsWith('/v1/messages') && !path.includes('count_tokens')) return { vendor: 'anthropic', category: 'llm' }
  if (host === 'api.openai.com' && /\/v1\/(chat\/completions|responses|completions)$/.test(path)) return { vendor: 'openai', category: 'llm' }
  if (host === 'api.openai.com' && /\/v1\/audio\//.test(path)) return { vendor: 'openai', category: 'audio' }
  if (host === 'api.openai.com' && /\/v1\/images\//.test(path)) return { vendor: 'openai', category: 'image' }
  if (host.endsWith('inceptionlabs.ai') && /chat\/completions|completions$/.test(path)) return { vendor: 'inception', category: 'llm' }
  if (host === 'api.tavily.com') return { vendor: 'tavily', category: 'search' }
  if (host === 'google.serper.dev') return { vendor: 'serper', category: 'search' }
  if (host === 'api.bolna.ai' && path === '/call') return { vendor: 'bolna', category: 'call' }
  if (host === 'api.browserbase.com' && /\/v1\/sessions\/?$/.test(path)) return { vendor: 'browserbase', category: 'session' }
  if (host === 'api.assemblyai.com' && /\/v2\/transcript\/?$/.test(path)) return { vendor: 'assemblyai', category: 'transcript' }
  if (host === 'api.resend.com' && /\/emails/.test(path)) return { vendor: 'resend', category: 'email' }
  return null
}

/** Token usage from an LLM response body (Anthropic, OpenAI chat/responses, OpenAI-compatible). */
export function tokensFromBody(body: any): { model: string | null; input: number | null; output: number | null } {
  const u = body?.usage || {}
  const input = num(u.input_tokens ?? u.prompt_tokens)
  const cacheRead = num(u.cache_read_input_tokens) || 0, cacheWrite = num(u.cache_creation_input_tokens) || 0
  const output = num(u.output_tokens ?? u.completion_tokens)
  // Cache writes bill at 1.25x input and cache reads at 0.1x (Anthropic); fold them into input-equivalent tokens.
  return { model: typeof body?.model === 'string' ? body.model : null, input: input == null ? null : Math.round(input + cacheWrite * 1.25 + cacheRead * 0.1), output }
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** Preserve provider token counters, not synthetic "input-equivalent" token counts. */
type RawUsageBody={model?:unknown;usage?:{input_tokens?:unknown;prompt_tokens?:unknown;output_tokens?:unknown;completion_tokens?:unknown;cache_read_input_tokens?:unknown;cache_creation_input_tokens?:unknown;prompt_tokens_details?:{cached_tokens?:unknown};input_tokens_details?:{cached_tokens?:unknown}}}
export function rawUsageFromBody(body: RawUsageBody | null | undefined) {
  const u = body?.usage || {}
  return { model: typeof body?.model === 'string' ? body.model : null,
    input: num(u.input_tokens ?? u.prompt_tokens), output: num(u.output_tokens ?? u.completion_tokens),
    cachedReadTokens: num(u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens),
    cachedWriteTokens: num(u.cache_creation_input_tokens),
    inputIncludesCached: u.prompt_tokens !== undefined || u.input_tokens_details !== undefined }
}

/** A missing price/usage is unavailable, never evidence of a free call. Cache rates are operator supplied. */
export function priceMeasuredEvent(e: MeterEvent, rates: RateCard): { inr: number; usd: number | null } | null {
  const valid = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  if (e.category !== 'llm') {
    const rate = rates[e.vendor + '.' + e.category]
    if (!rate || (!valid(rate.inr) && !valid(rate.usd)) || (e.units !== undefined && !valid(e.units))) return null
    return priceEvent(e, rates)
  }
  if (!valid(e.inputTokens) || !valid(e.outputTokens)) return null
  const family = modelFamily(e.vendor, e.model)
  const inputRate = rates[family + '.input']?.usd, outputRate = rates[family + '.output']?.usd
  if (!valid(inputRate) || !valid(outputRate)) return null
  const read = e.cachedReadTokens ?? 0, write = e.cachedWriteTokens ?? 0
  if (!valid(read) || !valid(write) || (e.inputIncludesCached && read > e.inputTokens!)) return null
  const readRate = rates[family + '.cache_read']?.usd, writeRate = rates[family + '.cache_write']?.usd
  if ((read > 0 && !valid(readRate)) || (write > 0 && !valid(writeRate))) return null
  const fresh = e.inputTokens! - (e.inputIncludesCached ? read : 0)
  const usd = (fresh * inputRate! + e.outputTokens! * outputRate! + read * (readRate || 0) + write * (writeRate || 0)) / 1e6
  const fx = rates['fx.usd_inr']?.inr
  if (!valid(fx) || !fx) return null
  return { inr: round4(usd * fx), usd: round6(usd) }
}
