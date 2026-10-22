import {supabaseAdmin} from '@/lib/supabase-admin'
import {isActionablePause} from './run-state'
import {browserAuthSummary} from './browser-auth-summary'

/** A Take control handoff older than this is no longer actionable (the provider session behind it is long gone),
 * so it leaves Needs you. The run itself is untouched and still shows in Activity. */
export const HANDOFF_MAX_AGE_HOURS=72

export type PendingBrowserHandoff={id:string;title:string;summary:string;updatedAt:string|null;repeats:number;cloud?:boolean}

// Read the actual paused browser handoffs separately from recent activity.
// A long conversation must not push an unresolved Take control task out of
// the dashboard's Needs you panel.
export async function getPendingBrowserHandoffs(telegramId:string,limit=20,now=Date.now()):Promise<PendingBrowserHandoff[]>{
  const found:PendingBrowserHandoff[]=[]
  const cutoff=new Date(now-HANDOFF_MAX_AGE_HOURS*3600_000).toISOString()
  // Exclude known retired states before limiting, so old closed tasks cannot
  // bury a live takeover or force unbounded sequential reads on every page.
  const {data,error}=await supabaseAdmin.from('agent_runs')
    .select('id,title,summary,status,error,metadata_json,updated_at')
    .eq('telegram_id',String(telegramId)).eq('status','paused')
    .gte('updated_at',cutoff)
    .contains('metadata_json',{handoff:{}})
    .or('metadata_json->handoff->>takeoverUrl.not.is.null,metadata_json->handoff->>providerUrl.not.is.null')
    .or('metadata_json->>state.is.null,metadata_json->>state.not.in.(closed_stale,closed)')
    .or('summary.is.null,summary.neq.Superseded by duplicate mission submission')
    .or('error.is.null,error.not.in.(stale_provider_access_limited,background_browser_resume_expired,stale_run_recovered,background_browser_actor_missing)')
    .order('updated_at',{ascending:false}).order('id',{ascending:false}).limit(limit*5)
  if(error)throw new Error('browser_handoff_lookup_failed')
  // Older summaries confused a saved-login failure with a code-send failure.
  // Read only the reason of the latest browser step; never fetch its page text,
  // credentials or handoff tokens, and never rewrite the historical run.
  const authRuns=(data||[]).filter(row=>row.error==='human_auth_required')
  const latestAuth=new Map<string,{status:string;error:string;reason:string;completedAt:string}>()
  if(authRuns.length){
    try{
      const {data:steps,error:stepError}=await supabaseAdmin.from('agent_steps')
        .select('id,run_id,ordinal,status,error,completed_at,auth_reason:output_json->>authReason')
        .eq('telegram_id',String(telegramId)).in('run_id',authRuns.map(row=>String(row.id))).eq('tool_name','secure_browser')
        .order('ordinal',{ascending:false}).order('completed_at',{ascending:false,nullsFirst:true}).order('id',{ascending:false}).limit(500)
      if(stepError)throw new Error('reason_unavailable')
      for(const step of steps||[]){
        const id=String(step.run_id)
        if(!latestAuth.has(id))latestAuth.set(id,{status:String(step.status||''),error:String(step.error||''),reason:typeof step.auth_reason==='string'?step.auth_reason:'',completedAt:String(step.completed_at||'')})
      }
    }catch{console.error('BROWSER_HANDOFF_REASON_UNAVAILABLE')}
  }
  // Fetch extra rows: repeats collapse below, so they must not use up the page.
  // The same blocked step (for example a robot check on one site) can pause many runs.
  // The person has one thing to do, so one card: the newest run, with a count of repeats.
  const byStep=new Map<string,PendingBrowserHandoff>()
  for(const row of data||[]){
    const handoff=row.metadata_json?.handoff
    if(!isActionablePause(row)||!handoff||!(handoff.takeoverUrl||(handoff.mode==='device'&&handoff.providerUrl)))continue
    const title=String(row.title||'Browser task')
    const summary=browserAuthSummary({...row,summary:row.summary||'Choose Take control to complete the provider step.'},latestAuth.get(String(row.id)),now)
    let host=''
    try{host=handoff.providerUrl?new URL(String(handoff.providerUrl)).hostname.toLowerCase():''}catch{host=''}
    const key=[title.trim().toLowerCase(),summary.trim().toLowerCase(),host].join('|')
    const seen=byStep.get(key)
    if(seen){seen.repeats+=1;continue}
    const card={id:String(row.id),title,summary,updatedAt:row.updated_at||null,repeats:0,cloud:Boolean(handoff.takeoverUrl)}
    byStep.set(key,card)
    found.push(card)
  }
  return found.slice(0,limit)
}

