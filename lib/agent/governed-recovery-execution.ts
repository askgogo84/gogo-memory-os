// A published recovery revision selects a fixed read adapter, never generated
// code, a new capability, a booking, a provider write or an approval.
import {randomUUID} from 'node:crypto'
import {supabaseAdmin} from '@/lib/supabase-admin'
import {exactSessionOwnerId} from '@/lib/dashboard/owner-identity'
import {normalizeTimezone} from '@/lib/timezone'
import {redactSecretShapedText} from '@/lib/bot/memory-redaction'
import {getCalendarAccountAccess,fetchMergedCalendarEventsPage} from '@/lib/services/google-calendar-accounts'
import {verifyGmailSentMessage} from '@/lib/services/google-gmail'
import {capabilityPermissionLevel} from './adaptive-autonomy'
import {activeRecoveryRevision} from './governed-review-store'
import {governedEnabled,openPersonalGovernedRuntime} from './governed-runtime'
import {currentGovernedRun,foregroundInTime,foregroundRuntime} from './governed-run-context'
import {governedFenceInstalled} from './governed-outbound-fence'
import {parseRecoveryRequest,exactRecoveryTitle,type RecoveryRequest} from './governed-recovery-profiles'
import {RECOVERY_SKILLS} from './governed-learning-candidates'
import {readableStart} from './typed-time-routing'
import {readGmailSendVerification} from './gmail-verification'
import {gmailAccess} from './gmail-send'
import {tryGetWatcherStatusFromCommand} from './watch-command'
import {recordDecisionLearning,type DecisionDomain} from './decision-learning'
import type {AgentActor} from './actor'

type Proof={verified:true;source:string;kind:'read';objectKind:string;objectRef:string}
type ReadResult={text:string;proof?:Proof}
const unavailable=(text:string):ReadResult=>({text})
const noChange='Nothing was changed or sent.'
const safe=(text:unknown)=>redactSecretShapedText(String(text||'')).slice(0,7000)
export function exactRecoveryMatch<T>(rows:readonly T[],title:(r:T)=>unknown,target:string,complete:boolean):{kind:'match';row:T}|{kind:'incomplete'|'ambiguous'|'missing'}{
  if(!complete)return {kind:'incomplete'}
  const key=exactRecoveryTitle(target),matches=rows.filter(r=>key&&exactRecoveryTitle(title(r))===key)
  return matches.length===1?{kind:'match',row:matches[0]}:{kind:matches.length>1?'ambiguous':'missing'}
}
function noMatch(kind:'incomplete'|'ambiguous'|'missing',object:string):ReadResult{
  return unavailable(kind==='incomplete'?'The '+object+' lookup was incomplete. I cannot verify one exact match. '+noChange:kind==='ambiguous'?'More than one '+object+' has that exact title. Please select the specific occurrence or account. '+noChange:'I could not find an exact '+object+' with that title in the checked records. '+noChange)
}
async function calendarRead(actor:AgentActor,target:string):Promise<ReadResult>{
  const {data,error}=await supabaseAdmin.from('users').select('id,telegram_id,access_status,google_calendar_connected,google_refresh_token,timezone').eq('id',actor.userId).eq('telegram_id',actor.legacyTelegramId).maybeSingle()
  if(error||!data||String(data.id)!==actor.userId||exactSessionOwnerId(data.telegram_id)!==String(actor.legacyTelegramId)||data.access_status!=='active')return unavailable('I could not verify your Calendar account. '+noChange)
  let incomplete=data.google_calendar_connected===true&&!data.google_refresh_token
  const accounts=await getCalendarAccountAccess(actor.legacyTelegramId,data.google_calendar_connected===true?data.google_refresh_token:null,()=>{incomplete=true})
  if(!accounts.length||incomplete)return unavailable('I could not read every connected Calendar account. Check the connection and try the exact title again. '+noChange)
  const now=Date.now(),page=await fetchMergedCalendarEventsPage(accounts,new Date(now-86400000).toISOString(),new Date(now+31*86400000).toISOString(),'RECOVERY_CALENDAR_READ_FAILED',100)
  const result=exactRecoveryMatch(page.events.filter(e=>e.status!=='cancelled'),e=>e.summary,target,!page.hasMore&&page.accountsRead===page.accountsTotal)
  if(result.kind!=='match')return noMatch(result.kind,'Calendar event in the next 31 days or previous day')
  const event=result.row,start=event.start?.dateTime||event.start?.date
  if(typeof event.id!=='string'||!event.id||typeof start!=='string'||!Number.isFinite(Date.parse(start)))return unavailable('The provider did not return an exact event time. '+noChange)
  const when=readableStart(start,normalizeTimezone(data.timezone),!!event.recurringEventId||!!event.recurrence)
  return {text:safe(event.summary)+': '+when+(event._account?'\nCalendar: '+safe(event._account):'')+'\n'+noChange,proof:{verified:true,source:'google_calendar',kind:'read',objectKind:'calendar_event',objectRef:event.id}}
}
async function reminderRead(actor:AgentActor,target:string):Promise<ReadResult>{
  const {data,error}=await supabaseAdmin.from('reminders').select('id,message,remind_at,timezone,sent').eq('telegram_id',actor.legacyTelegramId).eq('sent',false).order('remind_at',{ascending:true}).limit(101)
  if(error||!Array.isArray(data))return unavailable('I could not verify your saved reminders. '+noChange)
  const result=exactRecoveryMatch(data,r=>r.message,target,data.length<=100)
  if(result.kind!=='match')return noMatch(result.kind,'active reminder')
  const row=result.row
  if(row.id==null||typeof row.remind_at!=='string'||!Number.isFinite(Date.parse(row.remind_at)))return unavailable('The saved reminder has no verified time. '+noChange)
  return {text:safe(row.message)+': '+readableStart(row.remind_at,normalizeTimezone(row.timezone||actor.timezone))+'\n'+noChange,proof:{verified:true,source:'canonical_reminders',kind:'read',objectKind:'reminder',objectRef:String(row.id)}}
}
async function gmailRead(actor:AgentActor,text:string):Promise<ReadResult>{
  const result=await readGmailSendVerification({actor,text},async(messageId,threadId)=>{
    const access=await gmailAccess(actor)
    if(!access.ok)return {verified:false,reason:access.reason}
    return verifyGmailSentMessage(access.accessToken,messageId,threadId)
  })
  if(!result)return unavailable('I could not resolve the exact Gmail send. '+noChange)
  const p=result.verification
  return {text:safe(result.text),...(p.verified&&p.objectRef?{proof:{verified:true as const,source:'gmail',kind:'read' as const,objectKind:'gmail_send',objectRef:String(p.objectRef)}}:{})}
}
async function watcherRead(actor:AgentActor,text:string):Promise<ReadResult>{
  // The existing watcher view shows at most 12 active rows. Do not present a
  // bounded list as a complete account inventory or mint a full-read receipt.
  const count=await supabaseAdmin.from('agent_watchers').select('id',{count:'exact',head:true}).eq('telegram_id',String(actor.legacyTelegramId)).eq('active',true).neq('type','goal_review')
  if(count.error||typeof count.count!=='number')return unavailable('I could not verify your saved watches. '+noChange)
  const result=await tryGetWatcherStatusFromCommand({actor,text})
  if(!result)return unavailable('I could not verify your saved watches. '+noChange)
  const p='verification' in result?result.verification:undefined
  if(count.count>12)return {text:'Showing up to 12 of '+count.count+' active watches; this is a partial list.\n\n'+safe(result.text)}
  return {text:safe(result.text),...(p?.verified&&p.objectRef?{proof:{verified:true as const,source:'canonical_watchers',kind:'read' as const,objectKind:'watcher_collection',objectRef:String(p.objectRef)}}:{})}
}
const domains:Record<RecoveryRequest['skill'],DecisionDomain>={'calendar.exact.read':'calendar','email.exact.verify':'email','reminder.exact.read':'reminders','watcher.exact.status':'watchers'}
export async function tryGovernedRecoveryProfile(actor:AgentActor,text:string,directLiteral:boolean):Promise<{text:string;handledBy:string;status:'completed'|'paused';readOnly:true;mutated:false;capability:string;risk:'low';runId:string}|null>{
  const owner=exactSessionOwnerId(actor.legacyTelegramId)
  if(!directLiteral||!owner||!actor.userId||!governedEnabled('personal',owner))return null
  const request=parseRecoveryRequest(text)
  if(!request)return null
  const skill=RECOVERY_SKILLS.find(s=>s.id===request.skill)!
  const response=(value:string,verified=false)=>({text:value,handledBy:'reviewed-recovery:'+skill.id,status:verified?'completed' as const:'paused' as const,readOnly:true as const,mutated:false as const,capability:skill.caps[0],risk:'low' as const,runId:''})
  const denied=()=>response('I could not verify this reviewed read or its current permissions. '+noChange)
  try{
    const revision=await activeRecoveryRevision(owner,skill.id)
    if(!revision)return null
    if(!governedFenceInstalled())return denied()
    const parent=currentGovernedRun(),deadline=Date.now()+55_000
    const inTime=()=>Date.now()<deadline&&(parent?parent.owner===owner&&parent.inTime():foregroundInTime(owner))
    if(!inTime())return denied()
    const authorize=async()=>{
      const row=await activeRecoveryRevision(owner,skill.id)
      if(row?.digest!==revision.digest||row.profile!==revision.profile||row.generation!==revision.generation)return false
      const levels=await Promise.all(skill.caps.map(c=>capabilityPermissionLevel(owner,c)))
      return levels.every(l=>['read','draft','ask','auto'].includes(l))&&inTime()
    }
    const runtime=parent?parent.runtime:await foregroundRuntime(owner,()=>openPersonalGovernedRuntime(actor))
    if(!runtime)return denied()
    const outcome=await runtime.nestedSearch('recovery_read',async()=>{
      if(!await authorize())return unavailable('This reviewed read is no longer authorized. '+noChange)
      switch(request.skill){
        case 'calendar.exact.read':return calendarRead(actor,request.target!)
        case 'reminder.exact.read':return reminderRead(actor,request.target!)
        case 'email.exact.verify':return gmailRead(actor,text)
        case 'watcher.exact.status':return watcherRead(actor,text)
      }
    },inTime,authorize)
    if(outcome.state!=='completed'||!await authorize())return denied()
    const result=outcome.value,p=result.proof
    await recordDecisionLearning({actor,text,domain:domains[request.skill],handler:skill.handler,decisionId:randomUUID(),outcome:p?'verified_success':'clarified',verified:!!p,...(p?{objectKind:p.objectKind,objectRef:p.objectRef,readEvidence:p}:{})}).catch(()=>{})
    if(!await authorize())return denied()
    return response(result.text,!!p)
  }catch{return denied()}
}
