import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import { syncOpenLoopsForUser } from './open-loops'
import { isRelevantOpenLoop } from './task-lifecycle'
import { runAuthReason } from './task-status'
import { isAutonomyStatus, isFullTaskList, partitionAttentionRuns, ideaWatcherIds, currentWatcherIdeas, watcherSupportsCurrentIdea } from './attention-state'

function clean(value:unknown,max=300){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function fmt(iso:string|null|undefined,timezone='Asia/Kolkata'){
  if(!iso)return ''
  try{return new Intl.DateTimeFormat('en-IN',{timeZone:timezone,weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso))}catch{return ''}
}

export { isAutonomyStatus } from './attention-state'

export function isConnectionCapabilityQuery(text:string){
  return /^(?:please\s+)?(?:show|list)\s+(?:my\s+)?connected\s+(?:services|integrations|connections)\b/i.test(String(text||'').trim())
    && !/(?:\b(?:and|then|also)\s+|[.;]\s*)(?:connect|disconnect|reconnect|switch|grant|revoke)\b/i.test(text)
}

/** Saved owner state only: no provider authentication, token reads or health claim. */
export async function tryGetConnectionCapabilities(params:{actor:Pick<AgentActor,'legacyTelegramId'>;text:string}){
  if(!isConnectionCapabilityQuery(params.text))return null
  const tg=params.actor.legacyTelegramId
  if(!Number.isSafeInteger(tg)||tg===0)throw new Error('connection_capabilities_owner_missing')
  const read=async<T>(query:()=>PromiseLike<T>)=>{try{return await query()}catch{return{data:null,count:null,error:true as const}}}
  const [user,vault,travel,browser,consent]=await Promise.all([
    read(()=>supabaseAdmin.from('users').select('gmail_connected,gmail_send_connected,google_calendar_connected,whatsapp_id').eq('telegram_id',tg).maybeSingle()),
    read(()=>supabaseAdmin.from('vault_credentials').select('id',{count:'exact',head:true}).eq('telegram_id',tg)),
    read(()=>supabaseAdmin.from('travel_tickets').select('id',{count:'exact',head:true}).eq('telegram_id',tg).gte('depart_at',new Date().toISOString())),
    read(()=>supabaseAdmin.from('agent_permissions').select('level').eq('telegram_id',String(tg)).eq('capability','browser').maybeSingle()),
    read(()=>supabaseAdmin.from('user_consent_settings').select('gmail_enabled').eq('telegram_id',tg).maybeSingle()),
  ])
  const known=!user.error&&Boolean(user.data)
  const connection=(value:unknown)=>!known?'Unknown — saved state unavailable':value?'Connected (saved state)':'Not connected (saved state)'
  const count=(result:{error?:unknown;count?:number|null},noun:string)=>result.error||!Number.isInteger(result.count)||Number(result.count)<0?'Unknown — saved state unavailable':`${result.count} ${noun}`
  const level=String(browser.data?.level||'draft')
  const browserState=browser.error||!['off','read','draft','ask','auto'].includes(level)?'Unknown — permission unavailable':`Permission: ${level}`
  const gmailRead=consent.error?'Reading preference unknown':consent.data?.gmail_enabled===false?'Reading is off in privacy settings':'Reading follows saved consent'
  const link=known&&user.data.whatsapp_id?await read(()=>supabaseAdmin.from('wa_creditiq_links').select('consumer_user_id').eq('sender',user.data.whatsapp_id).maybeSingle()):null
  const creditState=!known||link?.error?'Unknown — linkage unavailable':link?.data?.consumer_user_id?'Linked (saved state)':'Not linked (saved state)'
  const text=[
    'Connected services — read-only saved-state report. Provider health is not independently verified.',
    `Google Calendar: ${connection(user.data?.google_calendar_connected)}. Operations: read events; propose event changes. Approval: exact changes require approval. Verification: provider event read-back.`,
    `Gmail: ${connection(user.data?.gmail_connected)}. ${gmailRead}. Operations: approved inbox reads and draft preparation. Sending ${known?user.data.gmail_send_connected?'is enabled but approval-gated':'is not enabled':'status unknown'}. Verification: provider message/Sent evidence.`,
    `Google Drive: ${known?user.data.gmail_connected?'Workspace connected; Drive scope/access not independently verified':'Workspace not connected':'Unknown — saved state unavailable'}. Operations: permitted file reads. Approval: sharing/writes need separate approval. Verification: provider file evidence.`,
    `Secure Browser: ${browserState}. Operations depend on permission and provider sign-in. Approval: submissions and consequential actions remain gated; secondary authentication stays human-only. Verification: task-relevant provider evidence.`,
    `Vault: ${count(vault,'saved logins')}. Operations: exact owner/domain login assistance in the secure browser. Approval: credential/account changes need specific approval. Verification: provider sign-in; a saved login alone proves no session.`,
    `Travel context: ${count(travel,'upcoming saved tickets')}. Operations: itinerary context and bounded monitoring when permitted. Approval: travel changes/bookings need approval. Verification: recorded itinerary and current provider evidence.`,
    `CreditIQ: ${creditState}. Operations: available linked-card context. Approval: payments and account changes need separate approval. Verification: bank/provider evidence; self-reported balances stay self-reported.`,
    'No connection, permission, account or provider changes were made.',
  ].join('\n\n')
  return{runId:'connection-capabilities',status:'completed' as const,text,handledBy:'connection-capabilities',readOnly:true,mutated:false}
}

export function isConnectionStatus(text:string){
  const t=clean(text,500).toLowerCase()
  return /^(?:which|what)\s+(?:google\s+)?(?:account|email|calendar|gmail)(?:\s+account)?\s+(?:am\s+i|is)\s+connected\s+(?:to|with)(?:\s+(?:askgogo|gogo|me))?\??$/.test(t)
    || /^(?:which|what)\s+gmail\s+account\s+is\s+(?:currently\s+)?connected\s+to\s+(?:askgogo|gogo|me)\??$/.test(t)
    || /^(?:which|what)\s+(?:email|calendar)\s+(?:am\s+i|is)\s+connected\s+(?:to|with)\??$/.test(t)
    || /^show\s+(?:my\s+)?connected\s+(?:google\s+)?accounts?\??$/.test(t)
}

export async function tryGetConnectionStatus(params:{actor:AgentActor;text:string}){
  const capabilities=await tryGetConnectionCapabilities(params)
  if(capabilities)return capabilities
  if(!isConnectionStatus(params.text))return null
  const {data,error}=await supabaseAdmin.from('users')
    .select('gmail_connected,gmail_send_connected,gmail_email,gmail_connected_at,google_calendar_connected,google_refresh_token')
    .eq('telegram_id',params.actor.legacyTelegramId)
    .maybeSingle()
  if(error)throw new Error(`connection_status_read_failed:${error.message}`)
  if(!data)return null
  const {data:consent,error:consentError}=await supabaseAdmin.from('user_consent_settings')
    .select('gmail_enabled').eq('telegram_id',params.actor.legacyTelegramId).maybeSingle()
  if(consentError)throw new Error('connection_status_consent_failed')
  const lines:string[]=[]
  if(data.gmail_connected){
    lines.push(`📧 Gmail / Workspace: connected${data.gmail_email?` as *${clean(data.gmail_email,160)}*`:''}`)
    lines.push(`Gmail reading: ${consent?.gmail_enabled===false?'off in your saved privacy preference':'enabled; connecting alone does not start an inbox watch'}`)
    lines.push(`✉️ Gmail Send: ${data.gmail_send_connected?'enabled (approval-gated)':'not enabled'}`)
  }else lines.push('📧 Gmail / Workspace: not connected')
  if(data.google_calendar_connected){
    let calendarAccounts:Array<{email:string|null}>=[]
    try{
      const {getCalendarAccountAccess}=await import('@/lib/services/google-calendar-accounts')
      calendarAccounts=await getCalendarAccountAccess(params.actor.legacyTelegramId,data.google_refresh_token?String(data.google_refresh_token):null)
    }catch{calendarAccounts=[]}
    const emails=calendarAccounts.map(a=>a.email).filter((e):e is string=>!!e)
    if(emails.length>1){
      lines.push(`📅 Google Calendar: ${emails.length} accounts connected`)
      emails.forEach((e,i)=>lines.push(`   ${i+1}. *${clean(e,160)}*${i===0?' (primary: new events go here unless you pick another)':''}`))
    }else lines.push(emails.length?`📅 Google Calendar: connected to *${clean(emails[0],160)}* (primary calendar)`:'📅 Google Calendar: connected to its primary calendar')
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

// ---------------------------------------------------------------------------------------------
// Digest presentation (19 Oct, modelled on Wajo's "Fo"): a few short lines, not a section dump.
//   1. What needs the user, one plain line each (max 3, then "+N more need you").
//   2. Background work in one sentence ("In the background: A, B and 4 more.").
//   3. The next life event within 48 h, if it fits.
//   4. At most one follow-up: how to see everything, only when something was left out.
// "show all tasks" gets the full list, one line per item. Pure: all inputs are passed in.
export type AutonomyDigestInput={
  approvals:any[]
  grouped:{activeNow:any[];incomplete:any[];pendingDecisions:any[];waitingContext:any[]}
  watchers:any[]
  events:any[]
  ideas:any[]
  /** Open loops (saved follow-ups), already filtered with isRelevantOpenLoop. */
  openLoops:any[]
  timezone:string
  now:Date
}
const DIGEST_MAX_LINES=6
const GROUP_MAX=3
function clip(value:unknown,max:number){
  const text=clean(value,2000)
  if(text.length<=max)return text
  const cut=text.slice(0,max-1)
  const space=cut.lastIndexOf(' ')
  return `${(space>max*0.6?cut.slice(0,space):cut).replace(/[\s,;:—-]+$/,'')}…`
}
const titleKey=(value:unknown)=>clean(value,200).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
function joinNames(names:string[],total:number){
  if(total>GROUP_MAX){const shown=names.slice(0,2);return `${shown.join(', ')} and ${total-shown.length} more`}
  if(names.length<=1)return names[0]||''
  return `${names.slice(0,-1).join(', ')} and ${names[names.length-1]}`
}
/** Identical labels are shown once with a count (19 Oct live: "News: Tata Motors" three times). */
function groupLabels(labels:string[]){
  const counts=new Map<string,number>()
  for(const label of labels)counts.set(label,(counts.get(label)||0)+1)
  return [...counts].map(([label,count])=>count>1?`${label} (×${count})`:label)
}

/** What the user must do for one item, in plain words. Never claims an unconfirmed outcome. */
function waitingItems(input:AutonomyDigestInput){
  const items:Array<{title:string;need:string}>=[]
  const seen=new Set<string>()
  const push=(title:unknown,need:string)=>{
    const key=titleKey(title)
    if(!key||seen.has(key))return
    seen.add(key)
    items.push({title:clip(title,70),need})
  }
  for(const approval of input.approvals)push(approval.title,'needs your OK — reply approve or reject.')
  for(const run of input.grouped.pendingDecisions)push(run.title,'needs your OK — reply approve or reject.')
  const context=input.grouped.waitingContext
  const auth=(run:any)=>String(run.status)==='paused'?runAuthReason(run):null
  // An unconfirmed outcome (maybe charged, maybe not) outranks sign-in steps.
  for(const run of context.filter(run=>String(run.status)==='outcome_unknown'))push(run.title,"— I couldn't confirm it went through. Please check with the provider before retrying.")
  for(const run of context.filter(run=>auth(run)==='otp'))push(run.title,"is paused until you enter a one-time code on the secure sign-in screen (please don't send it in chat).")
  for(const run of context.filter(run=>auth(run)==='sign_in'))push(run.title,"is paused until you sign in on the provider's site.")
  for(const run of context.filter(run=>String(run.status)==='paused'&&!auth(run))){
    const ask=clip(String(run.summary||'').replace(/^waiting for your input:\s*/i,''),90)
    push(run.title,ask?`is paused: ${/[.!?…]$/.test(ask)?ask:`${ask}.`}`:'is paused — say continue or cancel.')
  }
  return items.map(item=>`${item.title} ${item.need}`)
}

function backgroundLabels(input:AutonomyDigestInput){
  return groupLabels([
    ...input.grouped.activeNow.map(run=>clip(run.title,60)),
    ...input.grouped.incomplete.map(run=>clip(run.title,60)),
    ...input.watchers.map(w=>clip((w.condition_json as any)?.title||w.type,60)),
  ].filter(Boolean))
}

export function formatAutonomyDigest(input:AutonomyDigestInput,opts:{full?:boolean}={}){
  return opts.full?formatFullTaskList(input):formatShortDigest(input)
}

function formatShortDigest(input:AutonomyDigestInput){
  const waiting=waitingItems(input)
  const background=backgroundLabels(input)
  const soon=input.events.filter(e=>{const at=Date.parse(String(e.start_at||''));return Number.isFinite(at)&&at-input.now.getTime()<=48*3600000})
  const loops=groupLabels(input.openLoops.map(loop=>clip(loop.title,60)).filter(Boolean))

  if(!waiting.length&&!background.length&&!soon.length&&!loops.length&&!input.ideas.length&&!input.events.length)
    return 'Nothing is running in the background and nothing is waiting on you right now.'

  const head:string[]=[]
  for(const line of waiting.slice(0,GROUP_MAX))head.push(line)
  if(waiting.length>GROUP_MAX)head.push(`+${waiting.length-GROUP_MAX} more ${waiting.length-GROUP_MAX===1?'needs':'need'} you.`)
  if(background.length)head.push(`In the background: ${joinNames(background,background.length)}.`)
  else if(!waiting.length)head.push('Nothing is running right now and nothing needs you.')

  const hidden=Math.max(0,waiting.length-GROUP_MAX)+Math.max(0,background.length-GROUP_MAX)+loops.length+input.ideas.length
    +Math.max(0,input.events.length-(soon.length?1:0))
  const offer=hidden?(loops.length&&!background.length&&!waiting.length
    ?`You also have ${loops.length} saved follow-up${loops.length===1?'':'s'}. Reply *show all tasks* to see everything.`
    :'Reply *show all tasks* for the full list.'):''
  const next=soon[0]?`Coming up: ${clip(soon[0].title,70)}${fmt(soon[0].start_at,input.timezone)?` — ${fmt(soon[0].start_at,input.timezone)}`:''}.`:''

  const out=[...head]
  let followUp=offer
  if(next){
    if(out.length+1+(followUp?1:0)<=DIGEST_MAX_LINES)out.push(next)
    else followUp||='Reply *show all tasks* for the full list.' // still reachable through the full list
  }
  if(followUp)out.push(followUp)
  return out.slice(0,DIGEST_MAX_LINES).join('\n')
}

function formatFullTaskList(input:AutonomyDigestInput){
  const sections:string[]=[]
  const add=(title:string,items:string[])=>{if(items.length)sections.push(`*${title}*\n${items.map(item=>`• ${item}`).join('\n')}`)}
  add('Needs you',waitingItems(input))
  const runLine=(run:any)=>{
    const state=String(run.status)==='queued'?'queued, not started yet':'running'
    const at=fmt(run.updated_at,input.timezone)
    return `${clip(run.title,90)} — ${state}${at?` (updated ${at})`:''}`
  }
  add('Running',[...input.grouped.activeNow,...input.grouped.incomplete].map(runLine))
  add('Monitors',groupLabels(input.watchers.map(w=>`${clip((w.condition_json as any)?.title||w.type,90)} — every ~${Math.max(1,Number(w.cadence_minutes||60))} min`)))
  add('Open loops',groupLabels(input.openLoops.map(loop=>clip(loop.title,90)).filter(Boolean)))
  add('Coming up',input.events.map(e=>`${clip(e.title,90)}${fmt(e.start_at,input.timezone)?` — ${fmt(e.start_at,input.timezone)}`:''}`))
  add('Things I noticed',groupLabels(input.ideas.map(i=>clip(i.title,90)).filter(Boolean)))
  if(!sections.length)return 'Nothing is running in the background and nothing is waiting on you right now.'
  return sections.join('\n\n')
}

export async function tryGetAutonomyStatus(params:{actor:AgentActor;text:string}){
  if(!isAutonomyStatus(params.text))return null
  const tg=String(params.actor.legacyTelegramId)
  await syncOpenLoopsForUser(tg).catch((err:any)=>console.error('AUTONOMY_STATUS_OPEN_LOOP_SYNC_FAILED:',err?.message||err))
  const {data:user}=await supabaseAdmin.from('users').select('timezone').eq('telegram_id',params.actor.legacyTelegramId).maybeSingle()
  const timezone=String(user?.timezone||'Asia/Kolkata')
  const results=await Promise.all([
    supabaseAdmin.from('agent_runs').select('id,status,title,summary,progress,updated_at,error,metadata_json').eq('telegram_id',tg).in('status',['queued','running','waiting_approval','paused','outcome_unknown']).order('updated_at',{ascending:false}).limit(30),
    supabaseAdmin.from('agent_watchers').select('id,type,condition_json,cadence_minutes,next_check_at,active,created_at').eq('telegram_id',tg).eq('active',true).order('created_at',{ascending:false}).limit(8),
    supabaseAdmin.from('agent_approvals').select('id,title,risk_level,requested_at').eq('telegram_id',tg).eq('status','pending').order('requested_at',{ascending:false}).limit(5),
    supabaseAdmin.from('life_events').select('id,title,event_type,start_at,location,lifecycle_state').eq('telegram_id',tg).gte('start_at',new Date().toISOString()).order('start_at',{ascending:true}).limit(5),
    supabaseAdmin.from('agent_ideas').select('id,title,reason,value_score,status,created_at,source_refs').eq('telegram_id',tg).eq('status','new').order('value_score',{ascending:false}).limit(4),
    supabaseAdmin.from('agent_open_loops').select('id,kind,title,summary,priority,due_at,updated_at,source_type').eq('telegram_id',tg).eq('status','active').not('source_type','in','(approval,agent_run,life_event_action)').order('priority',{ascending:false}).limit(8),
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
  const text=formatAutonomyDigest({
    approvals:approvals||[],grouped,watchers:watchers||[],events:events||[],ideas:currentIdeas||[],
    openLoops:(openLoops||[]).filter(isRelevantOpenLoop),timezone,now:new Date(),
  },{full:isFullTaskList(params.text)})

  return {
    runId:'autonomy-status',
    status:'completed' as const,
    capability:'orchestrator' as const,
    risk:'low' as const,
    text,
    handledBy:'autonomy-status',
  }
}
