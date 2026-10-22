// Step-by-step narration for chat (Wajo-style, 23 Oct): while a task runs, one live line says what Gogo is doing now
// ("Reading the latest Zomato Instagram posts"); when it finishes, "Completed 6 steps" opens the list.
// Only real agent_steps rows are shown — never invented progress. Server-only reads are owner-scoped.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { shapeRunSteps, type RunSteps } from './run-steps-shared'
export * from './run-steps-shared'

export async function getRunSteps(telegramId: string, runId: string): Promise<RunSteps | null> {
  const tg = String(telegramId || '')
  if (!tg || !/^[0-9a-f-]{36}$/i.test(runId)) return null
  const { data: run, error } = await supabaseAdmin.from('agent_runs').select('id,status,title').eq('id', runId).eq('telegram_id', tg).maybeSingle()
  if (error || !run) return null
  const { data: rows } = await supabaseAdmin.from('agent_steps').select('ordinal,title,tool_name,status')
    .eq('run_id', runId).eq('telegram_id', tg).order('ordinal', { ascending: true }).limit(30)
  return shapeRunSteps(run, rows || [])
}

/** The newest task this owner started since `since` (the moment a chat message was sent), if any. */
export async function getLatestRunSince(telegramId: string, since: string): Promise<RunSteps | null> {
  const tg = String(telegramId || '')
  const at = Date.parse(since)
  if (!tg || !Number.isFinite(at)) return null
  const { data: run } = await supabaseAdmin.from('agent_runs').select('id,status,title').eq('telegram_id', tg)
    .gte('created_at', new Date(at - 2000).toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!run?.id) return null
  return getRunSteps(tg, String(run.id))
}
