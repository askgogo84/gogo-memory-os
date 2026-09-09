import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { createWebSearchWatcher, normalizeWebSearchWatcher } from './watchers'

function clean(value: unknown, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function parseWebWatchCommand(text: string) {
  const raw = clean(text, 2000)
  if (!raw) return null

  const patterns = [
    /^(?:please\s+)?(?:watch|monitor|track)\s+(?:the\s+)?(?:web|internet|online)\s+(?:for\s+)?(.+)$/i,
    /^(?:please\s+)?watch\s+(.+?)\s+(?:online|on\s+the\s+web)(?:\s+.*)?$/i,
  ]
  let query = ''
  for (const re of patterns) {
    const m = raw.match(re)
    if (m?.[1]) { query = m[1]; break }
  }
  if (!query) return null

  query = query
    .replace(/\s+(?:and\s+)?(?:tell|notify|alert|let)\s+me\s+(?:know\s+)?(?:when|if)\b.*$/i, '')
    .replace(/\s+and\s+message\s+me\b.*$/i, '')
    .trim()
  if (query.length < 3) return null

  const keywordMatch = raw.match(/(?:when|if)\s+(?:you\s+)?(?:see|find|spot|there(?:'s|\s+is))\s+(.+)$/i)
  const triggerKeywords = keywordMatch?.[1]
    ? keywordMatch[1].split(/,|\bor\b/i).map(x => x.trim()).filter(x => x.length >= 2).slice(0, 8)
    : []

  return normalizeWebSearchWatcher({
    title: `Watch: ${query.slice(0, 120)}`,
    query,
    triggerKeywords,
    delivery: 'both',
    cadenceMinutes: 60,
  })
}

async function browserWatchAllowed(telegramId: number) {
  const { data, error } = await supabaseAdmin.from('agent_permissions')
    .select('level')
    .eq('telegram_id', String(telegramId))
    .eq('capability', 'browser')
    .maybeSingle()
  if (error) throw new Error(`agent_permission_unavailable:${error.message}`)
  return String(data?.level || 'draft') !== 'off'
}

export async function tryCreateWebWatchFromCommand(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
}) {
  const condition = parseWebWatchCommand(params.text)
  if (!condition) return null

  const tg = String(params.actor.legacyTelegramId)
  if (!(await browserWatchAllowed(params.actor.legacyTelegramId))) {
    return {
      runId: 'watch-blocked',
      status: 'paused' as const,
      capability: 'browser' as const,
      risk: 'low' as const,
      text: 'Browser monitoring is off in Gogo Safe Mode. Turn Browser access back on to create this watch.',
      blockedReason: 'browser_permission_off',
    }
  }

  const now = new Date().toISOString()
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: tg,
    type: 'watcher',
    capability: 'browser',
    status: 'completed',
    title: condition.title,
    summary: `Background Gogo will check every ${condition.cadenceMinutes} minutes and surface meaningful new results.`,
    progress: 100,
    why: 'You asked Gogo to keep watching instead of repeatedly checking the web yourself.',
    source: params.surface,
    metadata_json: { input_text: clean(params.text, 2000), watcher_type:'web_search', query:condition.query },
    started_at: now,
    updated_at: now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`agent_run_create_failed:${runError?.message || 'unknown'}`)

  const watcher = await createWebSearchWatcher({ telegramId:tg, condition })
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: tg,
    run_id: String(run.id),
    event_type: 'watcher_created',
    message: `Background Gogo is watching the web: ${condition.query}`.slice(0, 900),
    metadata_json: { watcher_id:watcher.id, type:'web_search', cadence_minutes:condition.cadenceMinutes },
  })

  return {
    runId: String(run.id),
    status: 'completed' as const,
    capability: 'browser' as const,
    risk: 'low' as const,
    text: `Background Gogo is now watching “${condition.query}”. I’ll establish a baseline on the first check, then surface meaningful new results in Ideas${condition.delivery !== 'app' ? ' and WhatsApp' : ''}.`,
    handledBy: 'background-web-watch',
  }
}
