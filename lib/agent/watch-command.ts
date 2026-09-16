import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCostBudget } from '@/lib/services/cost-guard'
import { clearFollowupState, getLatestFollowupState, isStrictlyFreshFollowupState, saveFollowupState } from '@/lib/bot/handlers/followup-state'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { createWebSearchWatcher, normalizeWebSearchWatcher } from './watchers'
import { initialWatcherCadence, isUrgentWatchRequest, watcherUpgradeMessage } from './watch-cost-policy'

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
    cadenceMinutes: 15,
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
  const parsed = parseWebWatchCommand(params.text)
  if (!parsed) return null

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

  const budget = await getCostBudget(tg)
  if (budget.activeWebWatchersMax <= 0) {
    return {
      runId: 'watch-plan-blocked',
      status: 'paused' as const,
      capability: 'browser' as const,
      risk: 'low' as const,
      text: watcherUpgradeMessage(budget.planCode),
      blockedReason: 'plan_background_watch_unavailable',
    }
  }

  const { count, error: countError } = await supabaseAdmin.from('agent_watchers')
    .select('id', { count:'exact', head:true })
    .eq('telegram_id', tg)
    .eq('type', 'web_search')
    .eq('active', true)
  if (countError) throw new Error(`agent_watcher_count_failed:${countError.message}`)
  const activeWatcherCount = count || 0
  if (activeWatcherCount >= budget.activeWebWatchersMax) {
    return {
      runId: 'watch-plan-limit',
      status: 'paused' as const,
      capability: 'browser' as const,
      risk: 'low' as const,
      text: watcherUpgradeMessage(budget.planCode),
      blockedReason: 'plan_background_watch_limit',
    }
  }

  const urgent = isUrgentWatchRequest(params.text)
  const cadenceMinutes = initialWatcherCadence({
    budget,
    urgent,
    activeWatcherCount: activeWatcherCount + 1,
  })
  const burstUntil = urgent && budget.burstHours > 0
    ? new Date(Date.now() + budget.burstHours * 3600_000).toISOString()
    : null
  const condition = {
    ...parsed,
    cadenceMinutes,
    burstUntil,
  }

  const now = new Date().toISOString()
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: tg,
    type: 'watcher',
    capability: 'browser',
    status: 'completed',
    title: condition.title,
    summary: `Background Gogo is watching adaptively. It starts around every ${condition.cadenceMinutes} minutes and slows down when nothing changes.`,
    progress: 100,
    why: 'You asked Gogo to keep watching instead of repeatedly checking the web yourself.',
    source: params.surface,
    metadata_json: {
      input_text: clean(params.text, 2000), watcher_type:'web_search', query:condition.query,
      plan_code:budget.planCode, adaptive:true, burst_until:burstUntil,
    },
    started_at: now,
    updated_at: now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`agent_run_create_failed:${runError?.message || 'unknown'}`)

  const watcher = await createWebSearchWatcher({ telegramId:tg, condition })
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: tg,
    run_id: String(run.id),
    event_type: 'watcher_created',
    message: `Background Gogo is watching the web adaptively: ${condition.query}`.slice(0, 900),
    metadata_json: {
      watcher_id:watcher.id, type:'web_search', cadence_minutes:condition.cadenceMinutes,
      plan_code:budget.planCode, burst_until:burstUntil,
    },
  })

  return {
    runId: String(run.id),
    status: 'completed' as const,
    capability: 'browser' as const,
    risk: 'low' as const,
    text: `Background Gogo is now watching “${condition.query}”. I’ll establish a baseline first, then adapt the check frequency based on changes and your plan so quiet watches don’t waste your Gogo capacity. Meaningful updates appear in Ideas${condition.delivery !== 'app' ? ' and WhatsApp' : ''}.`,
    handledBy: 'background-web-watch',
  }
}

type PendingFlightWatch = {
  destination: string
  dateText: string
  originalText: string
  created_at: string
}

const FLIGHT_CODE_STOPWORDS = new Set([
  'AT', 'AM', 'PM', 'ON', 'TO', 'IN', 'BY', 'OF', 'OR', 'AN', 'AS', 'IF', 'IS', 'IT', 'ME', 'MY', 'WE', 'US', 'GO', 'DO', 'NO', 'SO', 'UP', 'AI',
])

function looksLikeIndependentCommand(text: string) {
  const raw = clean(text, 2000)
  if (!raw) return false
  return /^(?:please\s+)?(?:create|make|add|save|remind|schedule|show|list|find|search|look\s+for|check|book|reserve|order|buy|purchase|watch|monitor|track|send|email|message|plan|compare|open|go\s+to|cancel|delete|remove|update|change|move|call|tell|give|get)\b/i.test(raw)
    || /\b(?:then|and then)\s+(?:create|make|add|save|remind|schedule|show|find|search|check|book|reserve|order|buy|watch|monitor|send|plan|compare)\b/i.test(raw)
}

export function parseFlightIdentifier(text: string) {
  const raw = clean(text, 500)
  const match = raw.match(/\b([A-Z0-9]{2,3})\s*-?\s*(\d{1,4}[A-Z]?)\b/i)
  if (!match) return null
  const code = match[1].toUpperCase()
  const number = match[2].toUpperCase()

  // Never reinterpret ordinary prose/time fragments as a flight number.
  // The production failure was "...tomorrow at 9:00 AM..." => bogus flight "AT 9".
  if (FLIGHT_CODE_STOPWORDS.has(code)) return null
  const matchedEnd = (match.index || 0) + match[0].length
  if (raw.slice(matchedEnd).trimStart().startsWith(':')) return null

  const before = raw.slice(0, match.index || 0).trim().replace(/[-–—,:]+$/g, '').trim()
  const airline = before && before.length <= 80 ? before : ''
  return {
    code,
    number,
    flightNumber: `${code} ${number}`,
    airline,
    label: clean(`${airline ? `${airline} ` : ''}${code} ${number}`, 120),
  }
}

function parseFlightWatchRequest(text: string): PendingFlightWatch | null {
  const raw = clean(text, 2000)
  if (!/^(?:please\s+)?(?:watch|monitor|track)\s+(?:my\s+|the\s+)?flights?\b/i.test(raw)) return null

  const destinationMatch = raw.match(/\bto\s+(.+?)\s+on\s+(.+?)(?=\s+(?:and\s+)?(?:alert|notify|tell|let)\s+me\b|$)/i)
  const destination = clean(destinationMatch?.[1] || '', 120)
  const dateText = clean(destinationMatch?.[2] || '', 120)
  if (!destination || !dateText) return null

  return {
    destination,
    dateText,
    originalText: raw,
    created_at: new Date().toISOString(),
  }
}

function flightWatchPrompt() {
  return (
    `I need your flight details to track it, boss.\n\n` +
    `Reply with your airline and flight number (e.g. “AI 101” or “United 456”), ` +
    `or forward me the booking confirmation — I’ll pull the details and start monitoring ` +
    `for delays, gate changes and cancellations.`
  )
}

async function createFlightWatcherFromPending(params: {
  actor: AgentActor
  surface: AgentSurface
  pending: PendingFlightWatch
  identifier: ReturnType<typeof parseFlightIdentifier> extends infer T ? Exclude<T, null> : never
}) {
  const { actor, surface, pending, identifier } = params
  const synthesized =
    `watch the web for ${identifier.label} flight status to ${pending.destination} on ${pending.dateText} ` +
    `and alert me if you see delay, cancellation, gate change, schedule change, departure change or arrival change`

  const result = await tryCreateWebWatchFromCommand({ actor, surface, text: synthesized })
  if (!result) return null

  if (result.status === 'completed' && result.runId && !String(result.runId).includes('blocked') && !String(result.runId).includes('limit')) {
    await clearFollowupState(actor.legacyTelegramId, 'pending_flight_watch')
    return {
      ...result,
      text:
        `✅ *Flight watch started*\n\n` +
        `${identifier.label}\n` +
        `${pending.dateText} — ${pending.destination}\n\n` +
        `I’ll watch for important changes such as delays, cancellations, gate changes and schedule updates, ` +
        `and alert you when something materially changes.`,
      handledBy: 'flight-watch',
    }
  }

  return { ...result, handledBy: 'flight-watch' }
}

export async function tryCreateFlightWatchFromCommand(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
}) {
  const raw = clean(params.text, 2000)
  if (!raw) return null

  const freshPending = await getLatestFollowupState(params.actor.legacyTelegramId, 'pending_flight_watch')
  if (freshPending && isStrictlyFreshFollowupState(freshPending, 30) && !looksLikeIndependentCommand(raw)) {
    const identifier = parseFlightIdentifier(raw)
    if (identifier) {
      const pending = freshPending.payload as PendingFlightWatch
      if (pending?.destination && pending?.dateText) {
        return await createFlightWatcherFromPending({ actor:params.actor, surface:params.surface, pending, identifier })
      }
    }
  }

  const request = parseFlightWatchRequest(raw)
  if (!request) return null

  const identifier = parseFlightIdentifier(raw)
  if (identifier) {
    return await createFlightWatcherFromPending({ actor:params.actor, surface:params.surface, pending:request, identifier })
  }

  await saveFollowupState(params.actor.legacyTelegramId, 'pending_flight_watch', request)
  return {
    runId: 'flight-watch-awaiting-details',
    status: 'paused' as const,
    capability: 'browser' as const,
    risk: 'low' as const,
    text: flightWatchPrompt(),
    handledBy: 'flight-watch-followup',
  }
}
