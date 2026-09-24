import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import { syncOpenLoopsForUser } from './open-loops'
import { isAutonomyStatus, partitionAttentionRuns, ideaWatcherIds, currentWatcherIdeas, watcherSupportsCurrentIdea } from './attention-state'

function clean(value:unknown,max=300){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function fmt(iso:string|null|undefined,timezone='Asia/Kolkata'){
  if(!iso)return ''
  try{return new Intl.DateTimeFormat('en-IN',{timeZone:timezone,weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso))}catch{return ''}
}

export { isAutonomyStatus } from './attention-state'

export function isConnectionStatus(text:string){
  const t=clean(text,500).toLowerCase()
  return /^(?:which|what)\s+(?:google\s+)?(?:account|email|calendar|gmail)(?:\s+account)?\s+(?:am\s+i|is)\s+connected\s+(?:to|with)(?:\s+(?:askgogo|gogo|me))?\??$/.test(t)
    || /^(?:which|what)\s+gmail\s+account\s+is\s+(?:currently\s+)?connected\s+to\s+(?:askgogo|gogo|me)\??$/.test(t)
    || /^(?:which|what)\s+(?:email|calendar)\s+(?:am\s+i|is)\s+connected\s+(?:to|with)\??$/.test(t)
    || /^show\s+(?:my\s+)?connected\s+(?:google\s+)?accounts?\??$/.test(t)
}

export async function tryGetConnectionStatus(params:{actor:AgentActor;text:string}){
  if(!isConnectionStatus(params.text))return null
  const {data,error}=await supabaseAdmin.from('users')
    .select('gmail_connected,gmail_send_connected,gmail_email,gmail_connected_at,google_calendar_connected')
    .eq('telegram_id',params.actor.legacyTelegramId)
    .maybeSingle()
  if(error)throw new Error(`connection_status_read_failed:${error.message}`)
  if(!data)return null
  const lines:string[]=[]
  if(data.gmail_connected){
    lines.push(`📧 Gmail / Workspace: connected${data.gmail_email?` as *${clean(data.gmail_email,160)}*`:''}`)
    lines.push(`✉️ Gmail Send: ${data.gmail_send_connected?'enabled (approval-gated)':'not enabled'}`)
  }else lines.push('📧 Gmail / Workspace: not connected')
  if(data.google_calendar_connected){
    lines.push('📅 Google Calendar: connected to its primary calendar')
    if(!data.gmail_email)lines.push('_This older Calendar connection does not store the account email yet._')
  }else lines.push('📅 Google Calendar: not connected')
  return {
    runId:'connection-status',
    status:'completed' as const,
    capability:'memory' as const,
    risk:'low' as const,
    text:`🔗 *Connected accounts*\n\n${lines.join('\n')}\n\nI will not reconnect or switch accounts unless you ask.`,
    handledBy:'connection-status',
  }
}

export async function tryGetAutonomyStatus(params:{actor:AgentActor;text:string}){
  if(!isAutonomyStatus(params.text))return null
  const tg=String(params.actor.legacyTelegramId)
  await syncOpenLoopsForUser(tg).catch((err:any)=>console.error('AUTONOMY_STATUS_OPEN_LOOP_SYNC_FAILED:',err?.message||err))
  const {data:user}=await supabaseAdmin.from('users').select('timezone').eq('telegram_id',params.actor.legacyTelegramId).maybeSingle()
  const timezone=String(user?.timezone||'Asia/Kolkata')
  const results=await Promise.all([
    supabaseAdmin.from('agent_runs').select('id,status,title,summary,progress,updated_at,error').eq('telegram_id',tg).in('status',['queued','running','waiting_approval','paused','outcome_unknown']).order('updated_at',{ascending:false}).limit(30),
    supabaseAdmin.from('agent_watchers').select('id,type,condition_json,cadence_minutes,next_check_at,active,created_at').eq('telegram_id',tg).eq('active',true).order('created_at',{ascending:false}).limit(8),
    supabaseAdmin.from('agent_approvals').select('id,title,risk_level,requested_at').eq('telegram_id',tg).eq('status','pending').order('requested_at',{ascending:false}).limit(5),
    supabaseAdmin.from('life_events').select('id,title,event_type,start_at,location,lifecycle_state').eq('telegram_id',tg).gte('start_at',new Date().toISOString()).order('start_at',{ascending:true}).limit(5),
    supabaseAdmin.from('agent_ideas').select('id,title,reason,value_score,status,created_at,source_refs').eq('telegram_id',tg).eq('status','new').order('value_score',{ascending:false}).limit(4),
    supabaseAdmin.from('agent_open_loops').select('id,kind,title,priority,due_at,updated_at,source_type').eq('telegram_id',tg).eq('status','active').not('source_type','in','(approval,agent_run,life_event_action)').order('priority',{ascending:false}).limit(8),
  ])
  const failed=results.find((result:any)=>result.error)
  if(failed?.error)throw new Error(`autonomy_status_read_failed:${failed.error.message}`)
  const [rawRuns,watchers,approvals,events,ideas,openLoops]=results.map((result:any)=>result.data||[])
  const terminalPauseErrors=new Set(['stale_provider_access_limited','background_browser_resume_expired','stale_run_recovered','background_browser_actor_missing'])
  const runSeen=new Set<string>()
  const runs=(rawRuns||[]).filter((run:any)=>{
    if(String(run.status)==='paused'&&terminalPauseErrors.has(String(run.error||'')))return false
    const key=String(run.id)
    if(runSeen.has(key))return false
    runSeen.add(key)
    return true
  })
  const grouped=partitionAttentionRuns(runs)
  const ideaIds=[...new Set(ideas.flatMap(ideaWatcherIds))] as string[]
  let currentIdeas=ideas
  if(ideaIds.length){
    const {data:activeIdeaWatchers,error:ideaError}=await supabaseAdmin.from('agent_watchers').select('id,active,last_state_json')
      .eq('telegram_id',tg).in('id',ideaIds)
    if(ideaError)throw new Error('attention_watcher_evidence_read_failed')
    currentIdeas=currentWatcherIdeas(ideas,new Set((activeIdeaWatchers||[]).filter(watcherSupportsCurrentIdea).map((w:any)=>String(w.id))))
  }
  const runLines=(items:any[])=>items.slice(0,6).map(r=>`• ${clean(r.title,150)} — ${String(r.status).replaceAll('_',' ')}`).join('\n')

  const blocks:string[]=[]
  if(approvals?.length)blocks.push(`🛡️ *Waiting for you*\n${approvals.map((a:any)=>`• ${clean(a.title,160)}`).join('\n')}`)
  if(openLoops?.length)blocks.push(`🧩 *Open loops*\n${openLoops.slice(0,6).map((loop:any)=>`• ${clean(loop.title,160)}`).join('\n')}`)
  if(grouped.activeNow.length)blocks.push(`🧠 *Active now*\n${runLines(grouped.activeNow)}`)
  if(grouped.incomplete.length)blocks.push(`📋 *Incomplete tasks — queued*\n${runLines(grouped.incomplete)}`)
  if(grouped.pendingDecisions.length)blocks.push(`🛡️ *Pending decisions*\n${runLines(grouped.pendingDecisions)}`)
  if(grouped.waitingContext.length)blocks.push(`⏸️ *Dormant / waiting context*\n${runLines(grouped.waitingContext)}`)
  if(watchers?.length)blocks.push(`🔎 *Background monitors*\n${watchers.map((w:any)=>`• ${clean((w.condition_json as any)?.title||w.type,150)} — every ~${Math.max(1,Number(w.cadence_minutes||60))} min`).join('\n')}`)
  if(events?.length)blocks.push(`✈️ *Upcoming life events*\n${events.slice(0,3).map((e:any)=>`• ${clean(e.title,150)} — ${fmt(e.start_at,timezone)}`).join('\n')}`)
  if(currentIdeas?.length)blocks.push(`💡 *Things I noticed*\n${currentIdeas.slice(0,3).map((i:any)=>`• ${clean(i.title,150)}`).join('\n')}`)
  if(!blocks.length)blocks.push('Nothing is currently running in the background. Your autonomous queue is clear.')

  return {
    runId:'autonomy-status',
    status:'completed' as const,
    capability:'orchestrator' as const,
    risk:'low' as const,
    text:`🤖 *What Gogo is working on*\n\n${blocks.join('\n\n')}\n\nI’ll surface high-signal changes without waiting for you to ask.`,
    handledBy:'autonomy-status',
  }
}
