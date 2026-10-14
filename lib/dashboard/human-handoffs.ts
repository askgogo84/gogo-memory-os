import {supabaseAdmin} from '@/lib/supabase-admin'
import {isActionablePause} from './run-state'

/** A Take control handoff older than this is no longer actionable (the provider session behind it is long gone),
 * so it leaves Needs you. The run itself is untouched and still shows in Activity. */
export const HANDOFF_MAX_AGE_HOURS=72

export type PendingBrowserHandoff={id:string;title:string;summary:string;updatedAt:string|null;repeats:number}

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
  // Fetch extra rows: repeats collapse below, so they must not use up the page.
  // The same blocked step (for example a robot check on one site) can pause many runs.
  // The person has one thing to do, so one card: the newest run, with a count of repeats.
  const byStep=new Map<string,PendingBrowserHandoff>()
  for(const row of data||[]){
    const handoff=row.metadata_json?.handoff
    if(!isActionablePause(row)||!handoff||!(handoff.takeoverUrl||(handoff.mode==='device'&&handoff.providerUrl)))continue
    const title=String(row.title||'Browser task')
    const summary=String(row.summary||'Choose Take control to complete the provider step.')
    let host=''
    try{host=handoff.providerUrl?new URL(String(handoff.providerUrl)).hostname.toLowerCase():''}catch{host=''}
    const key=[title.trim().toLowerCase(),summary.trim().toLowerCase(),host].join('|')
    const seen=byStep.get(key)
    if(seen){seen.repeats+=1;continue}
    const card={id:String(row.id),title,summary,updatedAt:row.updated_at||null,repeats:0}
    byStep.set(key,card)
    found.push(card)
  }
  return found.slice(0,limit)
}

