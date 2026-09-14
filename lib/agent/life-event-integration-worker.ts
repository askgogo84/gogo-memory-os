import { supabaseAdmin } from '@/lib/supabase-admin'
import { runSecureBrowser } from './secure-computer'
import { sendAgentPush } from './push'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import { evaluateAgentSentinel } from './sentinel'
import { prepareBookingCalendarApproval } from './booking-calendar-execution'
import {
  calendarInputFromLifeEvent,
  lifecycleFingerprint,
  lifecycleMonitorTarget,
  lifecycleTerminalState,
} from './life-event-integrations'
import type { AgentActor } from './actor'

const LEASE_MINUTES = 8
const RETRY_BACKOFF_MINUTES = [5, 15, 60, 180, 360]
const DEDICATED_MONITOR_ACTION_KEYS = new Set(['booking-change-watch'])

function safe(value: unknown, max = 800) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function plusMinutes(minutes: number) {
  return new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString()
}

function permanentIntegrationFailure(error: unknown) {
  const message = safe((error as any)?.message || error, 500)
  return /\b(life_event_missing|life_event_actor_missing|agent_run_not_found|not_booking_calendar_plan|booking_calendar_event_invalid)\b/.test(message)
}

async function resolveActor(telegramId: string): Promise<AgentActor> {
  const { data, error } = await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name')
    .eq('telegram_id', Number(telegramId))
    .maybeSingle()
  if (error) throw new Error(`life_event_integration_actor_failed:${error.message}`)
  if (!data?.id || !data?.telegram_id) throw new Error('life_event_actor_missing')
  return {
    userId: String(data.id),
    legacyTelegramId: Number(data.telegram_id),
    whatsappId: String(data.whatsapp_id || ''),
    name: String(data.name || 'Gogo'),
  }
}

async function browserPermission(telegramId: string): Promise<AgentPermissionLevel> {
  const { data, error } = await supabaseAdmin.from('agent_permissions')
    .select('level').eq('telegram_id', telegramId).eq('capability', 'browser').maybeSingle()
  if (error) throw new Error(`life_event_integration_permission_failed:${error.message}`)
  return (data?.level as AgentPermissionLevel | undefined) || 'ask'
}

async function claim(action: any) {
  const expected = String(action.status || 'queued')
  const now = new Date().toISOString()
  let q = supabaseAdmin.from('life_event_actions').update({
    status: 'running',
    updated_at: now,
    payload_json: { ...(action.payload_json || {}), integrationLeaseUntil: plusMinutes(LEASE_MINUTES) },
  }).eq('id', action.id).eq('status', expected)
  if (expected === 'running' && action.updated_at) q = q.eq('updated_at', action.updated_at)
  const { data, error } = await q.select('id').maybeSingle()
  if (error) throw new Error(`life_event_integration_claim_failed:${error.message}`)
  return Boolean(data?.id)
}

async function defer(action: any, minutes: number, extra: Record<string, unknown> = {}) {
  const at = new Date().toISOString(), dueAt = plusMinutes(minutes)
  const { error } = await supabaseAdmin.from('life_event_actions').update({
    status: 'ready', due_at: dueAt, updated_at: at,
    payload_json: { ...(action.payload_json || {}), ...extra, deferredUntil: dueAt },
  }).eq('id', action.id).eq('status', 'running')
  if (error) throw new Error(`life_event_integration_defer_failed:${error.message}`)
}

async function retryOrBlock(action: any, telegramId: string, error: unknown) {
  const at = new Date().toISOString()
  const message = safe((error as any)?.message || error || 'life_event_integration_failed', 400)
  const previousRetries = Number(action.payload_json?.integrationRetryCount || 0)
  const retryCount = previousRetries + 1
  const exhausted = retryCount > RETRY_BACKOFF_MINUTES.length
  const permanent = permanentIntegrationFailure(error)

  if (!permanent && !exhausted) {
    const delay = RETRY_BACKOFF_MINUTES[Math.min(previousRetries, RETRY_BACKOFF_MINUTES.length - 1)]
    const dueAt = plusMinutes(delay)
    const { error: updateError } = await supabaseAdmin.from('life_event_actions').update({
      status: 'ready',
      due_at: dueAt,
      updated_at: at,
      payload_json: {
        ...(action.payload_json || {}),
        integrationRetryCount: retryCount,
        lastIntegrationError: message,
        deferredUntil: dueAt,
      },
    }).eq('id', action.id).eq('status', 'running')
    if (updateError) throw new Error(`life_event_integration_retry_schedule_failed:${updateError.message}`)
    await writeActivity(telegramId, null, 'life_event_integration_retry', 'Gogo will retry a temporary lifecycle integration failure.', {
      life_event_action_id: action.id,
      retry_count: retryCount,
      retry_at: dueAt,
      error: message,
    })
    return 'deferred' as const
  }

  const { error: updateError } = await supabaseAdmin.from('life_event_actions').update({
    status: 'blocked',
    updated_at: at,
    payload_json: {
      ...(action.payload_json || {}),
      integrationRetryCount: retryCount,
      blockedReason: message,
      blockedAt: at,
    },
  }).eq('id', action.id).eq('status', 'running')
  if (updateError) throw new Error(`life_event_integration_block_failed:${updateError.message}`)
  await writeActivity(telegramId, null, 'life_event_integration_blocked', 'Gogo paused a lifecycle integration after repeated or permanent failures.', {
    life_event_action_id: action.id,
    retry_count: retryCount,
    error: message,
  })
  await sendAgentPush(telegramId, {
    title: 'Gogo needs attention',
    body: 'A background task could not complete safely. Open Gogo Agent to review it.',
    path: '/agent',
    data: { lifeEventActionId: String(action.id) },
  }).catch(() => {})
  return 'blocked' as const
}

async function complete(action: any, extra: Record<string, unknown> = {}) {
  const at = new Date().toISOString()
  const { error } = await supabaseAdmin.from('life_event_actions').update({
    status: 'completed', updated_at: at,
    payload_json: { ...(action.payload_json || {}), ...extra, completedAt: at },
  }).eq('id', action.id).eq('status', 'running')
  if (error) throw new Error(`life_event_integration_complete_failed:${error.message}`)
}

async function createCompletedRun(telegramId: string, event: any, action: any, summary: string, metadata: Record<string, unknown> = {}) {
  const at = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: telegramId,
    type: 'life_event',
    capability: action.capability,
    status: 'completed',
    title: `Gogo · ${safe(event.title, 150)}`,
    summary: safe(summary, 1200),
    progress: 100,
    why: 'Background Gogo completed a safe lifecycle step for a saved life event.',
    source: 'background_life_event',
    metadata_json: {
      plan_type: 'life_event_integration', life_event_id: String(event.id),
      life_event_action_id: String(action.id), action_key: String(action.action_key), ...metadata,
    },
    started_at: at, completed_at: at, updated_at: at,
  }).select('id').single()
  if (error || !data?.id) throw new Error(`life_event_integration_run_failed:${error?.message || 'unknown'}`)
  return String(data.id)
}

async function writeActivity(telegramId: string, runId: string | null, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: telegramId, run_id: runId, event_type: eventType,
    message: safe(message, 900), metadata_json: metadata,
  }).catch(() => {})
}

async function processCalendarDraft(action: any, event: any, telegramId: string) {
  const input = calendarInputFromLifeEvent(event, action)
  if (!input) {
    await defer(action, 60, { blockedReason: 'calendar_context_incomplete' })
    return { status: 'deferred' as const }
  }
  const actor = await resolveActor(telegramId)
  const prepared = await prepareBookingCalendarApproval({ actor, input })
  if (!prepared) {
    await defer(action, 60, { blockedReason: 'calendar_context_incomplete' })
    return { status: 'deferred' as const }
  }
  await supabaseAdmin.from('life_event_actions').update({
    status: 'waiting_approval',
    updated_at: new Date().toISOString(),
    payload_json: { ...(action.payload_json || {}), runId: prepared.runId, approvalId: prepared.approvalId },
  }).eq('id', action.id).eq('status', 'running')
  await supabaseAdmin.from('life_events').update({ lifecycle_state: 'waiting_approval', updated_at: new Date().toISOString() })
    .eq('id', event.id).eq('telegram_id', telegramId)
  return { status: 'waiting_approval' as const, runId: prepared.runId, approvalId: prepared.approvalId }
}

async function processLifecycleMonitor(action: any, event: any, telegramId: string) {
  const target = lifecycleMonitorTarget(event, action)
  if (!target) {
    await defer(action, 360, { monitorState: 'waiting_for_status_url' })
    return { status: 'deferred' as const }
  }

  const permissionLevel = await browserPermission(telegramId)
  const policy = evaluateAgentExecutionPolicy({
    capability: 'browser', permissionLevel, mode: 'draft', risk: 'low', irreversible: false, approvalStatus: null,
  })
  const sentinel = evaluateAgentSentinel({
    capability: 'browser', mode: 'draft', risk: 'low', irreversible: false, approved: false,
    instruction: target.objective, url: target.url, actionCount: 6,
  })
  if (!policy.allowed || !sentinel.allowed) {
    const reason = !policy.allowed ? policy.reason : sentinel.reason
    await defer(action, 360, { monitorState: 'blocked_by_safe_mode', blockedReason: reason })
    return { status: 'deferred' as const }
  }

  const actor = await resolveActor(telegramId)
  const result = await runSecureBrowser({ userId: actor.userId, url: target.url, mode: 'draft', objective: target.objective })
  if (result.status === 'blocked') {
    const runId = await createCompletedRun(telegramId, event, action, safe(result.summary || 'This status page needs a secure human step.'), {
      monitor_url: target.url, blocked_reason: result.blockReason || 'human_auth_required', auth_reason: result.authReason || null,
    })
    await supabaseAdmin.from('agent_runs').update({ status:'paused', progress:55, completed_at:null, updated_at:new Date().toISOString() }).eq('id',runId)
    await supabaseAdmin.from('life_event_actions').update({
      status:'blocked', updated_at:new Date().toISOString(),
      payload_json:{...(action.payload_json||{}),monitorState:'human_auth_required',blockedReason:result.blockReason||'human_auth_required',authReason:result.authReason||null},
    }).eq('id',action.id).eq('status','running')
    await writeActivity(telegramId, runId, 'human_auth_required', 'Gogo paused lifecycle monitoring at a protected provider step.', { life_event_id:event.id, action_id:action.id })
    await sendAgentPush(telegramId, { title:'Gogo needs you', body:safe(result.summary || 'A protected provider step needs your attention.',240), path:'/agent', data:{runId,lifeEventId:String(event.id)} }).catch(()=>{})
    return { status:'blocked' as const, runId }
  }

  const pageText = safe(result.pageText || result.summary || '', 6000)
  const fingerprint = lifecycleFingerprint(result.title || event.title, pageText)
  const previous = String(action.payload_json?.lastFingerprint || '')
  const terminal = lifecycleTerminalState(String(event.event_type || ''), pageText, {
    title: event.title,
    confirmationRef: event.confirmation_ref,
    provider: event.provider,
  })
  const changed = Boolean(previous && previous !== fingerprint)
  const firstCheck = !previous
  const at = new Date().toISOString()

  if (firstCheck) {
    await defer(action, target.cadenceMinutes, { lastFingerprint:fingerprint, lastCheckedAt:at, lastStatusText:safe(pageText,800), monitorUrl:target.url })
    return { status:'deferred' as const }
  }

  if (!changed && !terminal.terminal) {
    await defer(action, target.cadenceMinutes, { lastFingerprint:fingerprint, lastCheckedAt:at, lastStatusText:safe(pageText,800), monitorUrl:target.url })
    return { status:'deferred' as const }
  }

  const summary = terminal.terminal
    ? `${event.title}: provider status is now ${terminal.label}.`
    : `${event.title}: the provider status page changed.`
  const runId = await createCompletedRun(telegramId, event, action, summary, { monitor_url:target.url, lifecycle_terminal:terminal.label, changed:true })
  await writeActivity(telegramId, runId, 'life_event_status_changed', summary, { life_event_id:event.id, action_id:action.id, terminal:terminal.label })
  await sendAgentPush(telegramId, { title:'Gogo found a status change', body:safe(summary,260), path:'/agent', data:{runId,lifeEventId:String(event.id)} }).catch(()=>{})

  const existingMeta = event.metadata_json || {}
  await supabaseAdmin.from('life_events').update({
    lifecycle_state: terminal.terminal ? 'completed' : 'watching',
    metadata_json: { ...existingMeta, lifecycleMonitor:{ url:target.url, fingerprint, checkedAt:at, terminal:terminal.label, statusText:safe(pageText,800) } },
    updated_at: at,
  }).eq('id',event.id).eq('telegram_id',telegramId)

  if (terminal.terminal) {
    await complete(action, { lastFingerprint:fingerprint, lastCheckedAt:at, terminal:terminal.label, monitorUrl:target.url })
    return { status:'completed' as const, runId }
  }
  await defer(action, target.cadenceMinutes, { lastFingerprint:fingerprint, lastCheckedAt:at, lastStatusText:safe(pageText,800), monitorUrl:target.url })
  return { status:'deferred' as const, runId }
}

async function processBillReview(action: any, event: any, telegramId: string) {
  const due = event.start_at ? new Date(event.start_at).toLocaleString('en-IN', { timeZone:event.timezone || 'Asia/Kolkata' }) : 'soon'
  const kind = event.event_type === 'subscription' ? 'renewal' : 'bill'
  const summary = `${event.title}: ${kind} review is due ${due}. Gogo has not paid, renewed, cancelled or changed anything.`
  const runId = await createCompletedRun(telegramId, event, action, summary, { payment_executed:false, review_type:kind })
  await supabaseAdmin.from('agent_ideas').insert({
    telegram_id:telegramId,
    title:event.title,
    reason:`${kind === 'renewal' ? 'Subscription renewal' : 'Bill'} is approaching.`,
    expected_value:'Review the amount, provider and whether you still want this before any payment or cancellation action.',
    value_score:0.9,
    action_label:'Review',
    source_refs:[{type:'life_event',id:String(event.id)}],
    status:'new',
  }).catch(()=>{})
  await complete(action,{reviewedAt:new Date().toISOString(),paymentExecuted:false})
  await writeActivity(telegramId,runId,'life_event_review_ready',summary,{life_event_id:event.id,action_id:action.id})
  await sendAgentPush(telegramId,{title:kind==='renewal'?'Subscription renewal coming up':'Bill review ready',body:safe(`${event.title} · ${due}`,240),path:'/agent',data:{runId,lifeEventId:String(event.id)}}).catch(()=>{})
  return { status:'completed' as const, runId }
}

async function processOne(action:any,event:any,telegramId:string){
  if(action.action_type==='calendar_draft')return processCalendarDraft(action,event,telegramId)
  if(action.action_type==='monitor')return processLifecycleMonitor(action,event,telegramId)
  if(action.action_key==='bill-review' && (event.event_type==='bill'||event.event_type==='subscription'))return processBillReview(action,event,telegramId)
  await defer(action,60,{integrationWorkerSkipped:true})
  return {status:'deferred' as const}
}

export async function processDueLifeEventIntegrations(limit=12){
  const now=new Date(),staleBefore=new Date(now.getTime()-LEASE_MINUTES*60_000).toISOString()
  const select='id,life_event_id,telegram_id,action_key,action_type,capability,title,due_at,status,payload_json,created_at,updated_at'
  const [calendar,due,stale]=await Promise.all([
    supabaseAdmin.from('life_event_actions').select(select).in('status',['queued','ready']).eq('action_type','calendar_draft').is('due_at',null).order('created_at',{ascending:true}).limit(limit),
    supabaseAdmin.from('life_event_actions').select(select).in('status',['queued','ready']).in('action_type',['calendar_draft','monitor','prepare']).not('action_key','in','("booking-change-watch")').not('due_at','is',null).lte('due_at',now.toISOString()).order('due_at',{ascending:true}).limit(limit),
    supabaseAdmin.from('life_event_actions').select(select).eq('status','running').in('action_type',['calendar_draft','monitor','prepare']).not('action_key','in','("booking-change-watch")').lte('updated_at',staleBefore).order('updated_at',{ascending:true}).limit(limit),
  ])
  if(calendar.error)throw new Error(`life_event_integration_calendar_read_failed:${calendar.error.message}`)
  if(due.error)throw new Error(`life_event_integration_due_read_failed:${due.error.message}`)
  if(stale.error)throw new Error(`life_event_integration_stale_read_failed:${stale.error.message}`)
  const rows=[...(stale.data||[]),...(calendar.data||[]),...(due.data||[])]
    .filter((row:any)=>!DEDICATED_MONITOR_ACTION_KEYS.has(String(row.action_key||'')))
    .filter((row:any,index:number,all:any[])=>all.findIndex((x:any)=>String(x.id)===String(row.id))===index)
    .slice(0,limit)
  let checked=0,claimed=0,completed=0,waitingApproval=0,deferred=0,blocked=0,failed=0
  for(const action of rows){
    checked++
    if(action.action_type==='prepare'&&action.action_key!=='bill-review')continue
    try{
      if(!(await claim(action)))continue
      claimed++
      const{data:event,error}=await supabaseAdmin.from('life_events').select('id,telegram_id,event_type,subtype,title,provider,start_at,end_at,timezone,location,confirmation_ref,lifecycle_state,preferences_json,metadata_json,source_refs').eq('id',action.life_event_id).eq('telegram_id',String(action.telegram_id)).maybeSingle()
      if(error)throw new Error(`life_event_integration_event_read_failed:${error.message}`)
      if(!event)throw new Error('life_event_missing')
      const result=await processOne(action,event,String(action.telegram_id))
      if(result.status==='completed')completed++
      else if(result.status==='waiting_approval')waitingApproval++
      else if(result.status==='blocked')blocked++
      else deferred++
    }catch(error:any){
      failed++
      console.error('LIFE_EVENT_INTEGRATION_FAILED:',action.id,error?.message||error)
      try{
        const disposition=await retryOrBlock(action,String(action.telegram_id),error)
        if(disposition==='deferred')deferred++
        else blocked++
      }catch(recoveryError:any){
        console.error('LIFE_EVENT_INTEGRATION_RECOVERY_FAILED:',action.id,recoveryError?.message||recoveryError)
      }
    }
  }
  return{checked,claimed,completed,waitingApproval,deferred,blocked,failed}
}
