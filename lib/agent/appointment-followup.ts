import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { tryRunBrowserCommand } from './browser-command'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

function safe(value: unknown, max = 1400) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

function optionNumber(text: string) {
  const match = String(text || '').match(/\b(?:option|choice)\s*#?\s*(\d{1,2})\b/i)
    || String(text || '').match(/\b(?:prepare|open|inspect|check|use|continue\s+with|book)\s+(\d{1,2})\b/i)
  const value = Number(match?.[1])
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : null
}

function wantsPrepare(text: string) {
  const t = String(text || '').toLowerCase()
  return /\b(prepare|open|inspect|check|use|continue with|book|booking)\b/.test(t) && /\b(option|choice|appointment)\b/.test(t)
}

function wantsFinalApproval(text: string) {
  const t = String(text || '').toLowerCase()
  return /\b(confirm|finali[sz]e|go ahead|complete|submit|book it|book this|reserve it)\b/.test(t) && /\b(appointment|slot|option|booking)\b/.test(t)
}

async function latestAppointmentResearch(tg: number) {
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .select('id,metadata_json,completed_at,started_at')
    .eq('telegram_id', String(tg))
    .eq('type', 'appointment_research')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`appointment_research_context_failed:${error.message}`)
  return data || null
}

async function latestPreparedAppointment(tg: number) {
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .select('id,metadata_json,status,completed_at,started_at')
    .eq('telegram_id', String(tg))
    .eq('type', 'secure_browser')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(12)
  if (error) throw new Error(`appointment_prepare_context_failed:${error.message}`)
  return (data || []).find((row: any) => row?.metadata_json?.appointment_selection?.url) || null
}

async function markPrepared(runId: string, tg: number, context: Record<string, unknown>) {
  const { data } = await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id', runId).eq('telegram_id', String(tg)).maybeSingle()
  const metadata = { ...(data?.metadata_json || {}), appointment_selection: context, appointment_prepared: true }
  await supabaseAdmin.from('agent_runs').update({ metadata_json: metadata, updated_at: new Date().toISOString() }).eq('id', runId).eq('telegram_id', String(tg))
}

async function createFinalApproval(params: { actor: AgentActor; prepared: any; text: string }) {
  const tg = params.actor.legacyTelegramId
  const runId = String(params.prepared.id)
  const meta: any = params.prepared.metadata_json || {}
  const selection: any = meta.appointment_selection || {}
  const url = safe(selection.url || meta.url || '', 1200)
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('appointment_prepare_url_missing')

  const { data: existing } = await supabaseAdmin.from('agent_approvals')
    .select('id,status').eq('telegram_id', String(tg)).eq('run_id', runId).eq('action_type', 'booking')
    .in('status', ['pending','approved']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing?.id) {
    return {
      runId, status: 'waiting_approval' as const, capability: 'browser' as const, risk: 'high' as const,
      text: 'This appointment action is already waiting for your approval. I will not submit it twice.',
      approvalId: String(existing.id), approvalRequired: true, handledBy: 'appointment-followup' as const,
    }
  }

  const { data: step, error: stepError } = await supabaseAdmin.from('agent_steps')
    .select('id').eq('run_id', runId).eq('telegram_id', String(tg)).eq('tool_name', 'secure_browser').limit(1).maybeSingle()
  if (stepError || !step?.id) throw new Error('appointment_prepare_step_missing')

  const objective = `Complete the prepared appointment flow on this provider page using the user's explicit confirmation: ${safe(params.text, 700)}. Re-check the exact slot/provider before final confirmation. Do not purchase paid add-ons. Stop if authentication, OTP, CAPTCHA, payment or materially different terms are required.`
  const nextMeta = {
    ...meta,
    url,
    objective,
    mode: 'execute',
    risk: 'high',
    approval_action: 'booking',
    appointment_selection: { ...selection, confirmation_text: safe(params.text, 700) },
  }

  const { data: approval, error } = await supabaseAdmin.from('agent_approvals').insert({
    telegram_id: String(tg), run_id: runId, action_type: 'booking',
    title: `Approve appointment confirmation${selection.title ? ` · ${safe(selection.title, 120)}` : ''}`,
    description: 'Gogo inspected this provider flow without submitting it. Approval allows one final appointment confirmation attempt. Authentication, OTP, CAPTCHA and payment still stop for you.',
    payload_preview: [
      { label: 'Provider', value: safe(selection.provider || new URL(url).hostname, 160) },
      { label: 'Selection', value: safe(selection.title || `Option ${selection.option || ''}`, 220) },
      { label: 'Your confirmation', value: safe(params.text, 400) },
      { label: 'Risk', value: 'high' },
    ],
    execution_payload: { plan_type: 'secure_browser', stepId: String(step.id), url },
    risk_level: 'high', status: 'pending',
  }).select('id').single()
  if (error || !approval?.id) throw new Error(`appointment_approval_failed:${error?.message || 'unknown'}`)

  const now = new Date().toISOString()
  await supabaseAdmin.from('agent_steps').update({ status: 'waiting_approval' }).eq('id', String(step.id))
  await supabaseAdmin.from('agent_runs').update({
    status: 'waiting_approval', summary: 'Appointment prepared. Waiting for your approval before final provider confirmation.',
    progress: 75, metadata_json: nextMeta, updated_at: now,
  }).eq('id', runId).eq('telegram_id', String(tg))

  return {
    runId, status: 'waiting_approval' as const, capability: 'browser' as const, risk: 'high' as const,
    text: 'I prepared the provider flow and need your approval before the final appointment confirmation. I will still stop for authentication, OTP, CAPTCHA or payment.',
    approvalId: String(approval.id), approvalRequired: true, handledBy: 'appointment-followup' as const,
  }
}

export async function tryRunAppointmentFollowup(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  const tg = params.actor.legacyTelegramId

  if (wantsFinalApproval(params.text)) {
    const prepared = await latestPreparedAppointment(tg)
    if (!prepared) return null
    return createFinalApproval({ actor: params.actor, prepared, text: params.text })
  }

  const number = optionNumber(params.text)
  if (!number || !wantsPrepare(params.text)) return null
  const research = await latestAppointmentResearch(tg)
  const options = Array.isArray(research?.metadata_json?.options) ? research.metadata_json.options : []
  const selected = options.find((item: any) => Number(item?.index) === number)
  if (!selected?.url) {
    return {
      runId: research?.id ? String(research.id) : '', status: 'paused' as const,
      capability: 'browser' as const, risk: 'low' as const,
      text: research ? `I don't have option ${number} in the last appointment search. Choose one of the listed options.` : 'I need an appointment search first before I can prepare an option.',
      handledBy: 'appointment-followup' as const,
    }
  }

  // Deliberately avoid booking/submit words in this constructed browser command so
  // the Secure Browser runs in DRAFT mode first. It may inspect live slots and fill
  // safe fields, but it cannot make the provider-side commitment yet.
  const objective = `Open ${selected.url} and inspect live appointment slots for ${safe(research.metadata_json?.service || 'the requested service', 120)}${research.metadata_json?.location ? ` in ${safe(research.metadata_json.location, 100)}` : ''}${research.metadata_json?.timing ? ` around ${safe(research.metadata_json.timing, 100)}` : ''}. Prepare the appointment form flow and fill only safe non-sensitive fields if already available. Stop before final confirmation, submission, authentication or payment.`
  const result = await tryRunBrowserCommand({ actor: params.actor, surface: params.surface, text: objective })
  if (!result) throw new Error('appointment_prepare_browser_not_routed')
  if (result.runId) {
    await markPrepared(result.runId, tg, {
      option: number,
      researchRunId: String(research.id),
      title: safe(selected.title || '', 220),
      provider: safe(selected.provider || '', 160),
      url: selected.url,
      service: safe(research.metadata_json?.service || '', 120),
      location: safe(research.metadata_json?.location || '', 120),
      timing: safe(research.metadata_json?.timing || '', 120),
    })
  }
  return {
    ...result,
    text: result.status === 'completed'
      ? `${result.text}\n\nI inspected option ${number} without confirming anything. If the provider/slot is right, explicitly tell me to confirm the appointment and include the slot you want; I will create the final approval boundary first.`
      : result.text,
    handledBy: 'appointment-followup' as const,
  }
}
