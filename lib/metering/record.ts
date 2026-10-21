import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentMeterContext, DEFAULT_RATES, priceEvent, type MeterEvent, type RateCard } from './core'

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

/** Record one metered call. Never throws and never blocks the caller for long. */
export async function recordMeterEvent(e: MeterEvent, telegramId?: string | number | null): Promise<void> {
  if (Date.now() < disabledUntil || process.env.ADMIN_METERING_ENABLED === 'false') return
  try {
    const who = telegramId != null && telegramId !== '' ? String(telegramId) : currentMeterContext()?.telegramId || 'system'
    const price = priceEvent(e, await loadRates())
    const { error } = await supabaseAdmin.from('admin_cost_events').insert({
      telegram_id: who,
      vendor: e.vendor,
      category: e.category,
      model: e.model || null,
      units: e.units ?? 1,
      input_tokens: e.inputTokens ?? null,
      output_tokens: e.outputTokens ?? null,
      cost_inr: price.inr,
      cost_usd: price.usd,
      ok: e.ok !== false,
      metadata: { ...(e.metadata || {}), surface: currentMeterContext()?.surface || null },
    })
    // Table not there yet (migration not applied): stop trying for 10 minutes.
    if (error) { if (/admin_cost_events|42P01|PGRST205/i.test(`${error.code} ${error.message}`)) disabledUntil = Date.now() + 10 * 60_000; else console.error('METER_RECORD_FAILED', error.code) }
  } catch (err: any) {
    console.error('METER_RECORD_FAILED', err?.message || err)
  }
}
