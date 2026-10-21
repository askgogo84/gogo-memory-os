import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { deliverNotification } from '@/lib/services/notification-delivery'
import { deliveryCallbackUrl } from '@/lib/services/delivery-callback'
import { isSuppressed } from '@/lib/bot/handlers/reminder-optout'
import type { RunNotifyDeps, RunNotifyResult, RunOutcomeLike } from './run-notify'

export function runOutcomeSnapshot(run: RunOutcomeLike) {
  return { status:run.status ?? null, title:run.title ?? null, summary:run.summary ?? null, error:run.error ?? null,
    outcome_state:run.metadata_json?.outcome_state ?? null, reconciliation_required:run.metadata_json?.reconciliation_required === true }
}

/** Same quiet window as the existing autonomy pulse. Invalid timezone fails closed. */
export function runOutcomeQuietUntil(timezone:string, now:Date):string|null {
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(now))
  return hour<7||hour>=22 ? new Date(now.getTime()+30*60_000).toISOString() : null
}

export async function deliverRunOutcomeNotice(runId:string, ownerId:string, render:(run:RunOutcomeLike)=>string, deps:RunNotifyDeps={}):Promise<RunNotifyResult> {
  const owner=Number(ownerId),db=deps.db||supabaseAdmin
  if(!Number.isSafeInteger(owner)||String(owner)!==ownerId)return {status:'failed',reason:'owner_invalid'}
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(name,args);if(error)throw Error(name+'_failed');return data}
  const key='run_outcome/'+runId+'/whatsapp'
  let run:RunOutcomeLike,phone='',timezone='',text=''
  const status=await deliverNotification({key,source:'run_outcome',owner,channel:'whatsapp',due:new Date(0).toISOString(),deadline:Date.now()+20_000,
    claim:token=>rpc('claim_run_outcome_delivery',{p_key:key,p_owner:owner,p_token:token}),
    prepare:async token=>{
      const [record,user]=await Promise.all([
        db.from('agent_runs').select('id,telegram_id,type,status,title,summary,error,metadata_json,completed_at').eq('id',runId).eq('telegram_id',ownerId).maybeSingle(),
        db.from('users').select('telegram_id,whatsapp_id,timezone').eq('telegram_id',owner).maybeSingle(),
      ])
      if(record.error||!record.data||user.error||!user.data?.whatsapp_id)throw Error('run_notice_owner_unavailable')
      run=record.data;phone=String(user.data.whatsapp_id);timezone=String(user.data.timezone||'Asia/Kolkata');text=render(run)
      if(!deps.send){
        const callback=new URL(deliveryCallbackUrl(String(process.env.TWILIO_STATUS_CALLBACK_URL||'').trim(),token))
        if(callback.protocol!=='https:'||callback.username||callback.password)throw Error('run_notice_callback_invalid')
      }
    },
    deferUntil:async()=>runOutcomeQuietUntil(timezone,deps.now?deps.now():new Date()),
    ready:async()=>!await isSuppressed(owner,phone),
    begin:token=>rpc('begin_run_outcome_delivery',{p_key:key,p_token:token,p_target:phone,p_snapshot:runOutcomeSnapshot(run)}),
    accepted:async()=>{try{await rpc('reconcile_run_outcome_notice_flags',{p_limit:10})}catch{console.error('RUN_NOTICE_COMPAT_ACK_FAILED')}},
    send:async token=>{
      const result=deps.send ? await deps.send(phone,text,token) : await (await import('@/lib/whatsapp')).sendWhatsApp(phone,text,undefined,token)
      return String((result as {sid?:unknown}|null)?.sid||'')
    },
  })
  if(['provider_accepted','deferred','suppressed','outcome_unknown'].includes(status))return {status:status as 'provider_accepted'|'deferred'|'suppressed'|'outcome_unknown'}
  if(status==='skipped')return {status:'skipped',reason:'ledger_ineligible'}
  return {status:'failed',reason:status}
}

/** Existing cron consumes a bounded outbox; never scan legacy terminal rows without explicit intent. */
export async function processRunOutcomeNotices(p:{deadline:number;limit?:number;db?:Pick<SupabaseClient,'from'|'rpc'>}) {
  const db=p.db||supabaseAdmin
  const repair=await db.rpc('reconcile_run_outcome_notice_flags',{p_limit:10})
  if(repair.error)throw Error('run_notice_flag_repair_failed')
  const {data,error}=await db.rpc('due_run_outcome_deliveries',{p_limit:Math.min(10,Math.max(1,p.limit||5))})
  if(error)throw Error('run_notice_queue_failed')
  const counts={checked:0,accepted:0,deferred:0,unknown:0,failed:0}
  const {notifyRunOutcome}=await import('./run-notify')
  for(const item of data||[]){
    if(Date.now()>=p.deadline)break
    counts.checked++
    const result=await notifyRunOutcome({id:String(item.run_id),telegram_id:String(item.owner_id)},{db})
    if(result.status==='provider_accepted')counts.accepted++
    else if(result.status==='deferred')counts.deferred++
    else if(result.status==='outcome_unknown')counts.unknown++
    else if(result.status==='failed')counts.failed++
  }
  return counts
}
