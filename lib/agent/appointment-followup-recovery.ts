import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { tryRunBrowserCommand } from './browser-command'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

function safe(value: unknown, max = 1200) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

export function appointmentPrepareOptionNumber(text: string) {
  const raw = String(text || '')
  const match = raw.match(/\b(?:prepare|open|inspect|check|use|continue(?:\s+with)?|review)\s+(?:the\s+)?(?:option|choice)?\s*#?\s*(\d{1,2})\b/i)
    || raw.match(/\b(?:option|choice)\s*#?\s*(\d{1,2})\b/i)
  const value = Number(match?.[1])
  if (!Number.isInteger(value) || value < 1 || value > 20) return null
  const lower = raw.toLowerCase()
  const prepareSignal = /\b(prepare|open|inspect|check|available|availability|slots?|use|continue|review)\b/.test(lower)
  return prepareSignal ? value : null
}

async function bestPriorResearch(tg: number) {
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .select('id,metadata_json,completed_at,started_at')
    .eq('telegram_id', String(tg))
    .eq('type', 'appointment_research')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(20)
  if (error) throw new Error(`appointment_followup_recovery_context_failed:${error.message}`)
  const rows = data || []
  // Prefer a search that has an explicit location. This deliberately skips accidental
  // follow-up searches such as "appointment provider · next week" that lost Bengaluru.
  return rows.find((row: any) => {
    const meta = row?.metadata_json || {}
    return safe(meta.location, 120) && Array.isArray(meta.options) && meta.options.length > 0
  }) || rows.find((row: any) => Array.isArray(row?.metadata_json?.options) && row.metadata_json.options.length > 0) || null
}

async function markPrepared(runId: string, tg: number, selection: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .select('metadata_json').eq('id', runId).eq('telegram_id', String(tg)).maybeSingle()
  if (error) throw new Error(`appointment_followup_recovery_run_read_failed:${error.message}`)
  const metadata = { ...(data?.metadata_json || {}), appointment_selection: selection, appointment_prepared: true }
  const { error: updateError } = await supabaseAdmin.from('agent_runs').update({
    metadata_json: metadata,
    updated_at: new Date().toISOString(),
  }).eq('id', runId).eq('telegram_id', String(tg))
  if (updateError) throw new Error(`appointment_followup_recovery_run_update_failed:${updateError.message}`)
}

export async function tryRecoverAppointmentOption(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  const option = appointmentPrepareOptionNumber(params.text)
  if (!option) return null

  const tg = params.actor.legacyTelegramId
  const research = await bestPriorResearch(tg)
  if (!research) {
    return {
      runId: '', status: 'paused' as const, capability: 'browser' as const, risk: 'low' as const,
      text: 'I can tell this is a follow-up to a previous appointment search, but I cannot recover the numbered provider options safely. Please run the provider search again; I will not substitute a new location.',
      handledBy: 'appointment-followup-recovery' as const,
    }
  }

  const meta: any = research.metadata_json || {}
  const options = Array.isArray(meta.options) ? meta.options : []
  const selected = options.find((item: any) => Number(item?.index) === option)
  if (!selected?.url) {
    return {
      runId: String(research.id), status: 'paused' as const, capability: 'browser' as const, risk: 'low' as const,
      text: `I recovered the ${safe(meta.location || 'previous', 100)} appointment search, but it does not contain option ${option}. Choose one of the numbered options from that result.`,
      handledBy: 'appointment-followup-recovery' as const,
    }
  }

  const objective = `Open ${selected.url} and inspect live appointment slots for ${safe(meta.service || 'the requested service', 120)}${meta.location ? ` in ${safe(meta.location, 100)}` : ''}${meta.timing ? ` around ${safe(meta.timing, 100)}` : ''}. Prepare the appointment flow and inspect availability. Do not confirm, submit, book, pay, authenticate, or change anything. Stop at any login, OTP, CAPTCHA or payment boundary.`
  const result = await tryRunBrowserCommand({ actor: params.actor, surface: params.surface, text: objective })
  if (!result) throw new Error('appointment_followup_recovery_browser_not_routed')

  if (result.runId) {
    await markPrepared(result.runId, tg, {
      option,
      researchRunId: String(research.id),
      title: safe(selected.title || '', 220),
      provider: safe(selected.provider || '', 160),
      url: selected.url,
      service: safe(meta.service || '', 120),
      location: safe(meta.location || '', 120),
      timing: safe(meta.timing || '', 120),
      recoveredContext: true,
    })
  }

  return {
    ...result,
    text: result.status === 'completed'
      ? `${result.text}\n\nI reused option ${option} from your ${safe(meta.location || 'previous', 100)} appointment search. I did not confirm or book anything.`
      : result.text,
    handledBy: 'appointment-followup-recovery' as const,
  }
}
