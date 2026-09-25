import { supabaseAdmin } from '@/lib/supabase-admin'
import { rememberTypedObjects } from './typed-object-context'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
import { tryRunBrowserCommand } from './browser-command'
import { registerLifeEvent } from './life-event-engine'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

function safe(value: unknown, max = 1400) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

const MONTHS: Record<string, number> = {
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
  jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12,
}

function pad(value: number) { return String(value).padStart(2, '0') }

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

function localYmd(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now)
  const values: Record<string,string> = {}
  for (const part of parts) if (part.type !== 'literal') values[part.type] = part.value
  return `${values.year}-${values.month}-${values.day}`
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`
}

function explicitDate(text: string, timezone: string) {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`

  if (/\btomorrow\b/i.test(text)) return addDays(localYmd(new Date(), timezone), 1)
  if (/\btoday\b/i.test(text)) return localYmd(new Date(), timezone)

  const dayMonth = text.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[,\s]+(20\d{2}))?\b/i)
  const monthDay = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:[,\s]+(20\d{2}))?\b/i)
  const match = dayMonth || monthDay
  if (!match) return null

  const today = localYmd(new Date(), timezone)
  const currentYear = Number(today.slice(0,4))
  const monthText = dayMonth ? match[2] : match[1]
  const day = Number(dayMonth ? match[1] : match[2])
  const year = Number((dayMonth ? match[3] : match[3]) || currentYear)
  const month = MONTHS[String(monthText).toLowerCase()]
  if (!month || day < 1 || day > 31) return null
  const candidate = `${year}-${pad(month)}-${pad(day)}`
  if (match[3] || candidate >= today) return candidate
  return `${year + 1}-${pad(month)}-${pad(day)}`
}

function explicitClock(text: string) {
  const withMinutes = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i)
  const hourOnly = text.match(/\b(\d{1,2})\s*(am|pm)\b/i)
  const match = withMinutes || hourOnly
  if (!match) return null
  let hour = Number(match[1])
  const minute = withMinutes ? Number(match[2]) : 0
  const meridiem = String(withMinutes ? withMinutes[3] : hourOnly?.[2] || '').toLowerCase()
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  return `${pad(hour)}:${pad(minute)}`
}

async function actorTimezone(actor: AgentActor) {
  const { data } = await supabaseAdmin.from('users').select('timezone').eq('telegram_id', actor.legacyTelegramId).maybeSingle()
  return normalizeTimezone(String(data?.timezone || 'Asia/Kolkata'))
}

async function exactSlot(text: string, actor: AgentActor) {
  const timezone = await actorTimezone(actor)
  const date = explicitDate(text, timezone)
  const time = explicitClock(text)
  if (!date || !time) return null
  const parsed = parseLocalDateTime({ date, time, timezone })
  if (!Number.isFinite(parsed.dueAtUtc.getTime()) || parsed.dueAtUtc.getTime() <= Date.now()) return null
  return { date, time, timezone, startAt: parsed.dueAtUtc.toISOString() }
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

  const slot = await exactSlot(params.text, params.actor)
  if (!slot) {
    return {
      runId, status: 'paused' as const, capability: 'browser' as const, risk: 'low' as const,
      text: 'I have the prepared provider flow, but I need the exact appointment date and time before I can create the final approval. For example: “Confirm this appointment for 20 September 2026 at 4:00 PM.”',
      handledBy: 'appointment-followup' as const,
    }
  }

  const explicitOption = optionNumber(params.text)
  if (explicitOption && Number(selection.option) !== explicitOption) {
    return {
      runId, status:'paused' as const, capability:'browser' as const, risk:'low' as const,
      text:`The prepared appointment is option ${selection.option}, not option ${explicitOption}. Prepare the option you want first so I do not confirm the wrong provider.`,
      handledBy:'appointment-followup' as const,
    }
  }

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

  const objective = `Complete the prepared appointment flow on this provider page for exactly ${slot.date} at ${slot.time} (${slot.timezone}), using the user's explicit confirmation: ${safe(params.text, 600)}. Re-check the exact slot and provider before final confirmation. Do not purchase paid add-ons. Stop if authentication, OTP, CAPTCHA, payment or materially different terms are required.`
  const nextMeta = {
    ...meta,
    url,
    objective,
    mode: 'execute',
    risk: 'high',
    approval_action: 'booking',
    appointment_selection: {
      ...selection,
      confirmation_text: safe(params.text, 700),
      scheduled_at: slot.startAt,
      scheduled_date: slot.date,
      scheduled_time: slot.time,
      timezone: slot.timezone,
    },
  }

  const { data: approval, error } = await supabaseAdmin.from('agent_approvals').insert({
    telegram_id: String(tg), run_id: runId, action_type: 'booking',
    title: `Approve appointment confirmation${selection.title ? ` · ${safe(selection.title, 120)}` : ''}`,
    description: 'Gogo inspected this provider flow without submitting it. Approval allows one final appointment confirmation attempt. Authentication, OTP, CAPTCHA and payment still stop for you.',
    payload_preview: [
      { label: 'Provider', value: safe(selection.provider || new URL(url).hostname, 160) },
      { label: 'Selection', value: safe(selection.title || `Option ${selection.option || ''}`, 220) },
      { label: 'Appointment', value: `${slot.date} ${slot.time} · ${slot.timezone}` },
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
    text: `I prepared the provider flow for ${slot.date} at ${slot.time} and need your approval before final confirmation. I will still stop for authentication, OTP, CAPTCHA or payment.`,
    approvalId: String(approval.id), approvalRequired: true, handledBy: 'appointment-followup' as const,
  }
}

export async function finalizeApprovedAppointmentRun(params: { actor: AgentActor; runId: string; result: any }) {
  if (!params.result || params.result.status !== 'completed') return params.result
  const tg = params.actor.legacyTelegramId
  const { data: run, error } = await supabaseAdmin.from('agent_runs')
    .select('metadata_json').eq('id', params.runId).eq('telegram_id', String(tg)).maybeSingle()
  if (error || !run) return params.result
  const meta: any = run.metadata_json || {}
  const selection: any = meta.appointment_selection || {}
  if (!selection?.url || !selection?.scheduled_at) return params.result

  const evidence = safe(params.result.text || '', 5000)
  const confirmed = /\b(appointment|booking|reservation)\b[\s\S]{0,160}\b(confirmed|booked|scheduled|successful|complete(?:d)?)\b|\b(confirmed|booked|scheduled)\b[\s\S]{0,120}\b(appointment|booking|reservation)\b/i.test(evidence)
  if (!confirmed) {
    return {
      ...params.result,
      text: `${params.result.text}\n\nI completed the approved browser attempt, but I could not verify provider-side appointment confirmation from the resulting page. I therefore did not create calendar/reminder/watch follow-ups.`,
      appointmentVerified: false,
    }
  }

  const start = new Date(selection.scheduled_at)
  if (!Number.isFinite(start.getTime())) return params.result
  const end = new Date(start.getTime() + 60 * 60_000)
  const lifeEvent = await registerLifeEvent({
    telegramId: tg,
    eventType: 'appointment',
    subtype: safe(selection.service || 'appointment', 100),
    source: 'secure_browser_confirmed',
    title: safe(selection.title || `${selection.service || 'Appointment'} appointment`, 240),
    provider: safe(selection.provider || '', 160) || null,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timezone: safe(selection.timezone || 'Asia/Kolkata', 100),
    location: safe(selection.location || '', 240) || null,
    metadata: {
      bookingUrl: selection.url,
      statusUrl: selection.url,
      browserRunId: params.runId,
      providerConfirmationVerified: true,
      autonomousSource: 'appointment_browser_closure',
    },
    sourceRefs: [
      { type:'agent_run', id:params.runId },
      ...(selection.researchRunId ? [{ type:'appointment_research_run', id:String(selection.researchRunId) }] : []),
    ],
  })

  await supabaseAdmin.from('agent_runs').update({
    metadata_json: { ...meta, appointment_life_event_id:lifeEvent.id, appointment_verified:true },
    updated_at:new Date().toISOString(),
  }).eq('id', params.runId).eq('telegram_id', String(tg))

  return {
    ...params.result,
    text: `${params.result.text}\n\nProvider confirmation verified. I linked this appointment into Gogo's Life Event runtime. Calendar creation remains approval-gated; readiness reminders and provider-change watching will continue from this event.`,
    appointmentVerified: true,
    lifeEventId: lifeEvent.id,
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
    await rememberTypedObjects(tg,'browser',[{id:String(result.runId),title:safe(selected.title||'Appointment option',220)}])
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
      ? `${result.text}\n\nI inspected option ${number} without confirming anything. If the provider/slot is right, explicitly tell me to confirm the appointment and include the exact date and time; I will create the final approval boundary first.`
      : result.text,
    handledBy: 'appointment-followup' as const,
  }
}
