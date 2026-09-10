import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateUserInsights } from '@/lib/bot/memory-twin/insight-generator'

const MAX_USERS_PER_PASS = 80

export async function processLearningPass() {
  const since = new Date(Date.now() - 36 * 3600_000).toISOString()

  const { data: events, error } = await supabaseAdmin
    .from('user_behavior_events')
    .select('telegram_id,created_at')
    .gte('created_at', since)
    .order('created_at', { ascending:false })
    .limit(5000)

  if (error) throw new Error(`learning_event_read_failed:${error.message}`)

  const ids = Array.from(new Set((events || [])
    .map((row:any) => Number(row.telegram_id))
    .filter(Number.isFinite)))
    .slice(0, MAX_USERS_PER_PASS)

  let processed=0
  let insights=0
  let ideas=0
  const failures:string[]=[]

  for (const telegramId of ids) {
    try {
      const result = await generateUserInsights(telegramId)
      processed += 1
      insights += result.length
      ideas += result.filter((x:any) => x.ideaCreated).length
    } catch (err:any) {
      failures.push(`${telegramId}:${String(err?.message || 'learning_failed').slice(0,120)}`)
    }
  }

  return {
    usersConsidered:ids.length,
    processed,
    insights,
    ideas,
    failures:failures.slice(0,10),
  }
}
