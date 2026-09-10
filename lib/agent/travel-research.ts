import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWebResults } from '@/lib/web-search'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

function safe(value: unknown, max = 1600) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

export function isPublicTravelResearchRequest(rawText: string) {
  const text = String(rawText || '').trim()
  const t = text.toLowerCase()
  if (!/\b(flight|flights|airfare|fare|fares|hotel|hotels|travel|trip)\b/.test(t)) return false

  // Explicit saved/private travel context must keep using AskGogo Memory/travel retrieval.
  if (/\b(my\s+(flight|ticket|booking|reservation|pnr|boarding pass|itinerary)|saved\s+(flight|ticket|booking)|show\s+my\s+(flight|ticket)|find\s+my\s+(flight|ticket))\b/.test(t)) return false

  return /\b(cheap|cheapest|best\s+(fare|price|deal)|compare|comparison|price|prices|fare|fares|deal|deals|available|availability|options|search|research|look\s+for|find\s+(a|me\s+a)|next\s+week|this\s+week|next\s+month)\b/.test(t)
}

async function addActivity(tg: number, runId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: String(tg),
    run_id: runId,
    event_type: eventType,
    message: safe(message, 900),
    metadata_json: metadata,
  })
  if (error) console.error('TRAVEL_RESEARCH_ACTIVITY_FAILED:', error.message)
}

export async function tryRunTravelResearch(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  if (!isPublicTravelResearchRequest(params.text)) return null

  const tg = params.actor.legacyTelegramId
  const now = new Date().toISOString()
  const query = `${String(params.text).trim()} current live fares options official airline booking`

  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: String(tg),
    type: 'travel_research',
    capability: 'travel',
    status: 'running',
    title: safe(params.text, 100),
    summary: 'Gogo is checking current public travel options.',
    progress: 20,
    why: 'This asks for current public travel options, not a saved ticket.',
    source: params.surface,
    metadata_json: { plan_type: 'travel_research', input_text: safe(params.text, 1800), query },
    started_at: now,
    updated_at: now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`travel_research_run_create_failed:${runError?.message || 'unknown'}`)

  const runId = String(run.id)
  const { data: step, error: stepError } = await supabaseAdmin.from('agent_steps').insert({
    telegram_id: String(tg),
    run_id: runId,
    ordinal: 1,
    tool_name: 'web_search',
    title: 'Search current public travel options',
    status: 'running',
    input_json: { query },
    output_json: {},
    started_at: now,
  }).select('id').single()
  if (stepError || !step?.id) throw new Error(`travel_research_step_create_failed:${stepError?.message || 'unknown'}`)

  await addActivity(tg, runId, 'run_started', 'Gogo started a current travel search.', { query: safe(query, 500) })

  try {
    const results = await searchWebResults(query)
    const top = results.slice(0, 5)
    const completedAt = new Date().toISOString()
    const output = { results: top.map(r => ({ title: r.title, url: r.url, snippet: safe(r.snippet, 500) })) }

    await supabaseAdmin.from('agent_steps').update({
      status: 'completed',
      output_json: output,
      completed_at: completedAt,
    }).eq('id', String(step.id))

    const text = top.length
      ? `I searched current public travel options — I did not use your saved tickets.\n\n${top.map((r, i) => `${i + 1}. ${r.title}\n${safe(r.snippet, 420)}\n${r.url}`).join('\n\n')}\n\nFares can change quickly, so verify the final price on the airline or booking page before paying.`
      : `I checked the public web for current travel options, but I couldn't find reliable live results right now. I did not use your saved tickets. Try again with exact dates and route, for example: “BLR to BOM, 16–18 Sep, one-way”.`

    await supabaseAdmin.from('agent_runs').update({
      status: 'completed',
      summary: safe(text, 1800),
      progress: 100,
      completed_at: completedAt,
      updated_at: completedAt,
    }).eq('id', runId).eq('telegram_id', String(tg))

    await addActivity(tg, runId, 'run_completed', top.length ? `Found ${top.length} current public travel results.` : 'No reliable current travel results found.', { result_count: top.length })

    return {
      runId,
      status: 'completed' as const,
      capability: 'travel' as const,
      risk: 'low' as const,
      text,
      handledBy: 'travel-research' as const,
    }
  } catch (error: any) {
    const message = safe(error?.message || 'travel_research_failed', 500)
    const completedAt = new Date().toISOString()
    await supabaseAdmin.from('agent_steps').update({ status: 'failed', error: message, completed_at: completedAt }).eq('id', String(step.id)).catch(() => {})
    await supabaseAdmin.from('agent_runs').update({ status: 'failed', summary: 'Gogo could not complete the current travel search.', error: message, completed_at: completedAt, updated_at: completedAt }).eq('id', runId).eq('telegram_id', String(tg)).catch(() => {})
    await addActivity(tg, runId, 'run_failed', 'Current travel research failed.', { error: message })
    throw error
  }
}
