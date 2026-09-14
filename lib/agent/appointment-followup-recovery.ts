import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { searchWebResults } from '@/lib/web-search'
import { tryRunBrowserCommand } from './browser-command'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

function safe(value: unknown, max = 1200) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./,'') } catch { return '' }
}

function sameProviderHost(a: string, b: string) {
  const left = host(a)
  const right = host(b)
  if (!left || !right) return false
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

function looksBookable(url: string, title = '') {
  const value = `${url} ${title}`.toLowerCase()
  return /\b(book appointment|schedule appointment|request appointment|appointment booking|available slots?)\b/.test(value)
    || /\/(book|booking|appointment|appointments|schedule|slots?|availability)(\/|\?|$)/.test(value)
    || /book[-_]?appointment|appointment[-_]?booking|schedule[-_]?appointment/.test(value)
}

function hasLiveSlotEvidence(text: string) {
  const value = safe(text, 9000).toLowerCase()
  const slotSignal = /\b(available\s+(?:appointment\s+)?slots?|appointment\s+times?|select\s+(?:a\s+)?(?:slot|time|date)|choose\s+(?:a\s+)?(?:slot|time|date)|time\s+slots?)\b/.test(value)
  const times = value.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/gi) || []
  return slotSignal && times.length > 0
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
    .eq('telegram_id', String(tg)).eq('type', 'appointment_research').eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false }).limit(20)
  if (error) throw new Error(`appointment_followup_recovery_context_failed:${error.message}`)
  const rows = data || []
  return rows.find((row:any) => {
    const meta = row?.metadata_json || {}
    return safe(meta.location,120) && Array.isArray(meta.options) && meta.options.length > 0
  }) || rows.find((row:any) => Array.isArray(row?.metadata_json?.options) && row.metadata_json.options.length > 0) || null
}

async function resolveBookableTarget(selected: any, meta: any) {
  const originalUrl = safe(selected?.url || '',1200)
  if (!originalUrl) return { url:'', resolved:false, queries:[] as string[] }
  if (looksBookable(originalUrl, safe(selected?.title || '',240))) return { url:originalUrl, resolved:false, queries:[] as string[] }
  const originalHost = host(originalUrl)
  if (!originalHost) return { url:originalUrl, resolved:false, queries:[] as string[] }

  const queries = [
    `site:${originalHost} "book appointment"`,
    `site:${originalHost} appointment booking schedule`,
    [safe(selected?.title || selected?.provider || originalHost,180), safe(meta?.service || 'appointment',100), safe(meta?.location || '',100), 'book appointment schedule online'].filter(Boolean).join(' '),
  ]
  const resultSets = await Promise.all(queries.map(query => searchWebResults(query).catch(() => [])))
  const seen = new Set<string>()
  const sameProvider = resultSets.flat().filter((result:any) => {
    const url = String(result?.url || '')
    if (!url || seen.has(url) || !sameProviderHost(url, originalUrl)) return false
    seen.add(url)
    return true
  })
  const best = sameProvider.find((result:any) => looksBookable(String(result?.url || ''), `${result?.title || ''} ${result?.snippet || ''}`))
  return best?.url ? { url:String(best.url), resolved:true, queries } : { url:originalUrl, resolved:false, queries }
}

async function retireStaleBookingApprovals(tg: number, targetUrl: string) {
  const { data: approvals, error } = await supabaseAdmin.from('agent_approvals')
    .select('id,run_id,status,created_at,title,execution_payload').eq('telegram_id',String(tg)).eq('action_type','booking').eq('status','pending')
    .order('created_at',{ascending:false}).limit(20)
  if (error) throw new Error(`appointment_stale_approval_read_failed:${error.message}`)
  let retired = 0
  const targetHost = host(targetUrl)
  for (const approval of approvals || []) {
    const executionUrl = safe((approval as any)?.execution_payload?.url || '',1200)
    let oldUrl = executionUrl
    if (!oldUrl) {
      const { data: run } = await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id',String(approval.run_id)).eq('telegram_id',String(tg)).maybeSingle()
      const meta:any = run?.metadata_json || {}
      oldUrl = safe(meta?.appointment_selection?.url || meta?.url || '',1200)
    }
    const titleMatches = targetHost && safe((approval as any)?.title || '',400).toLowerCase().includes(targetHost.toLowerCase())
    if (!sameProviderHost(oldUrl,targetUrl) && !titleMatches) continue
    const { error:updateError } = await supabaseAdmin.from('agent_approvals').update({
      status:'rejected', resolved_at:new Date().toISOString(), resolution_note:'Superseded by a later explicit read-only appointment availability check.'
    }).eq('id',String(approval.id)).eq('telegram_id',String(tg)).eq('status','pending')
    if (updateError) throw new Error(`appointment_stale_approval_retire_failed:${updateError.message}`)
    retired++
  }
  return retired
}

async function markPrepared(runId: string, tg: number, selection: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id',runId).eq('telegram_id',String(tg)).maybeSingle()
  if (error) throw new Error(`appointment_followup_recovery_run_read_failed:${error.message}`)
  const metadata = { ...(data?.metadata_json || {}), appointment_selection:selection, appointment_prepared:true }
  const { error:updateError } = await supabaseAdmin.from('agent_runs').update({ metadata_json:metadata, updated_at:new Date().toISOString() }).eq('id',runId).eq('telegram_id',String(tg))
  if (updateError) throw new Error(`appointment_followup_recovery_run_update_failed:${updateError.message}`)
}

export async function tryRecoverAppointmentOption(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  const option = appointmentPrepareOptionNumber(params.text)
  if (!option) return null
  const tg = params.actor.legacyTelegramId
  const research = await bestPriorResearch(tg)
  if (!research) {
    return { runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,
      text:'I can tell this is a follow-up to a previous appointment search, but I cannot recover the numbered provider options safely. Please run the provider search again; I will not substitute a new location.',
      handledBy:'appointment-followup-recovery' as const }
  }

  const meta:any = research.metadata_json || {}
  const options = Array.isArray(meta.options) ? meta.options : []
  const selected = options.find((item:any) => Number(item?.index) === option)
  if (!selected?.url) {
    return { runId:String(research.id),status:'paused' as const,capability:'browser' as const,risk:'low' as const,
      text:`I recovered the ${safe(meta.location || 'previous',100)} appointment search, but it does not contain option ${option}. Choose one of the numbered options from that result.`,
      handledBy:'appointment-followup-recovery' as const }
  }

  const target = await resolveBookableTarget(selected,meta)
  const staleApprovalsRetired = await retireStaleBookingApprovals(tg,target.url)

  const objective = `Open ${target.url} and inspect the provider appointment flow for ${safe(meta.service || 'the requested service',120)}${meta.location ? ` in ${safe(meta.location,100)}` : ''}${meta.timing ? ` around ${safe(meta.timing,100)}` : ''}. Navigate within this provider website to its appointment or scheduling page if needed. Fill only safe non-sensitive search fields if needed to reveal available dates or times. Make no provider-side changes. Stop before any final action, login, OTP, CAPTCHA, authentication challenge, or financial step.`
  const result = await tryRunBrowserCommand({ actor:params.actor,surface:params.surface,text:objective })
  if (!result) throw new Error('appointment_followup_recovery_browser_not_routed')

  const availabilityVerified = result.status === 'completed' && hasLiveSlotEvidence(result.text || '')
  if (result.runId) {
    await markPrepared(result.runId,tg,{
      option,researchRunId:String(research.id),title:safe(selected.title || '',220),provider:safe(selected.provider || '',160),
      url:target.url,originalUrl:selected.url,bookablePathResolved:target.resolved,availabilityVerified,staleApprovalsRetired,
      service:safe(meta.service || '',120),location:safe(meta.location || '',120),timing:safe(meta.timing || '',120),recoveredContext:true,
    })
  }

  if (result.status === 'completed' && !availabilityVerified) {
    return {
      ...result,
      status:'paused' as const,
      text:`${result.text}\n\nI reused option ${option} from your ${safe(meta.location || 'previous',100)} appointment search${target.resolved ? ' and switched to the same provider\'s direct appointment path' : ''}, but I could not verify actual live appointment dates/times from the provider page. I did not book anything or create a new approval.`,
      handledBy:'appointment-followup-recovery' as const,
      availabilityVerified:false,
    }
  }

  return {
    ...result,
    text: result.status === 'completed'
      ? `${result.text}\n\nI reused option ${option} from your ${safe(meta.location || 'previous',100)} appointment search${target.resolved ? ' and switched to the same provider\'s direct appointment path' : ''}. I verified live slot evidence and made no provider-side changes.`
      : result.text,
    handledBy:'appointment-followup-recovery' as const,
    availabilityVerified,
  }
}
