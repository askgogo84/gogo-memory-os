import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentMeterContext, DEFAULT_RATES, priceMeasuredEvent, type MeterEvent, type RateCard } from './core'

let rates: RateCard = DEFAULT_RATES
let ratesAt = 0
let disabledUntil = 0

async function loadRates(): Promise<RateCard> {
  if (Date.now() - ratesAt < 10 * 60_000) return rates
  ratesAt = Date.now()
  try {
    const { data, error } = await supabaseAdmin.from('admin_rate_card').select('key, usd_per_unit, inr_per_unit')
    if (!error && data?.length) {
      const next: RateCard = { ...DEFAULT_RATES }
      for (const row of data as any[]) next[row.key] = { usd: row.usd_per_unit == null ? null : Number(row.usd_per_unit), inr: row.inr_per_unit == null ? null : Number(row.inr_per_unit) }
      rates = next
    }
  } catch { /* keep defaults */ }
  return rates
}

/** Keep a serverless function alive until this background write finishes (Vercel request context), so the
 *  last model call before a reply is not lost when the response is sent. No-op outside Vercel. */
export function keepAlive<T>(work: Promise<T>): Promise<T> {
  try {
    const ctx = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.()
    ctx?.waitUntil?.(work.catch(() => undefined))
  } catch { /* not on Vercel */ }
  return work
}

/** Record one metered call. Never throws and never blocks the caller for long. */
export function recordMeterEvent(e: MeterEvent, telegramId?: string | number | null): Promise<void> {
  return keepAlive(writeMeterEvent(e, telegramId))
}
async function writeMeterEvent(e: MeterEvent, telegramId?: string | number | null): Promise<void> {
  if (Date.now() < disabledUntil || process.env.ADMIN_METERING_ENABLED === 'false') return
  try {
    const context = currentMeterContext()
    const who = telegramId != null && telegramId !== '' ? String(telegramId) : currentMeterContext()?.telegramId || 'system'
    const price = priceMeasuredEvent(e, await loadRates())
    const { error } = await supabaseAdmin.from('admin_cost_events').insert({
      telegram_id: who,
      vendor: e.vendor,
      category: e.category,
      model: e.model || null,
      units: e.units ?? 1,
      input_tokens: e.inputTokens ?? null,
      output_tokens: e.outputTokens ?? null,
      cost_inr: price?.inr ?? 0, // legacy NOT NULL column; pricing_status below distinguishes missing from zero
      cost_usd: price?.usd ?? null,
      ok: e.ok !== false,
      metadata: { ...(e.metadata || {}), surface: context?.surface || null,
        // Explicit owner overrides must never inherit another owner's run context.
        ...(context?.telegramId === who ? { run_id: context.runId || null, step_id: context.stepId || null,
          attempt: context.attempt ?? null, decision_id: context.decisionId || null, approval_id: context.approvalId || null } : { run_id: null, step_id: null, attempt: null, decision_id: null, approval_id: null }),
        cached_read_tokens: e.cachedReadTokens ?? null, cached_write_tokens: e.cachedWriteTokens ?? null,
        input_includes_cached: e.inputIncludesCached ?? null,
        pricing_status: price ? 'estimated' : 'unavailable', rate_source: 'operator_rate_card',
      },
    })
    // Table not there yet (migration not applied): stop trying for 10 minutes.
    if (error) { if (/admin_cost_events|42P01|PGRST205/i.test(`${error.code} ${error.message}`)) disabledUntil = Date.now() + 10 * 60_000; else console.error('METER_RECORD_FAILED', error.code) }
  } catch (err: any) {
    console.error('METER_RECORD_FAILED', err?.message || err)
  }
}
