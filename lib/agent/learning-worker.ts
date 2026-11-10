import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateUserInsights } from '@/lib/bot/memory-twin/insight-generator'
import { exactSessionOwnerId } from '@/lib/dashboard/owner-identity'

const MAX_USERS_PER_PASS = 80

/** One learning pass, bounded in time. Users are worked a few at a time and the pass stops starting new users once
 *  the time budget is spent, so the cron always finishes inside its limit. The starting point rotates every run, so
 *  users late in the list are not starved when a pass cannot reach everyone. */
export async function processLearningPass(opts: { budgetMs?: number; concurrency?: number; now?: number; generate?: (id: string) => Promise<any[]>; events?: { telegram_id: unknown }[] } = {}) {
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? 40_000
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8))
  const generate = opts.generate || generateUserInsights
  let events = opts.events
  if (!events) {
    const since = new Date((opts.now ?? Date.now()) - 36 * 3600_000).toISOString()
    const { data, error } = await supabaseAdmin
      .from('user_behavior_events')
      .select('telegram_id,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending:false })
      .limit(5000)
    if (error) throw new Error(`learning_event_read_failed:${error.message}`)
    events = data || []
  }

  // BIGINT owners must not collapse through JS Number before private synthesis.
  // The parser rejects rounded numeric and malformed identities without guessing.
  const all = Array.from(new Set(events
    .map((row:any) => exactSessionOwnerId(row.telegram_id))
    .filter((id): id is string => id !== null)))
    .sort()
  const offset = all.length ? Math.floor((opts.now ?? Date.now()) / 600_000) % all.length : 0 // moves every 10 minutes
  const ids = [...all.slice(offset), ...all.slice(0, offset)].slice(0, MAX_USERS_PER_PASS)

  let processed=0
  let insights=0
  let ideas=0
  let next=0
  const failures:string[]=[]
  const worker = async () => {
    while (next < ids.length && Date.now() - started < budgetMs) {
      const telegramId = ids[next++]
      try {
        const result = await generate(telegramId)
        processed += 1
        insights += result.length
        ideas += result.filter((x:any) => x.ideaCreated).length
      } catch (err:any) {
        failures.push(`${telegramId}:${String(err?.message || 'learning_failed').slice(0,120)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker))

  return {
    usersConsidered:ids.length,
    processed,
    deferred: ids.length - processed - failures.length,
    insights,
    ideas,
    ms: Date.now() - started,
    failures:failures.slice(0,10),
  }
}
