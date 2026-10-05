import {supabaseAdmin} from '@/lib/supabase-admin'
import {isActionablePause} from './run-state'

export type PendingBrowserHandoff={id:string;title:string;summary:string;updatedAt:string|null}

// Read the actual paused browser handoffs separately from recent activity.
// A long conversation must not push an unresolved Take control task out of
// the dashboard's Needs you panel.
export async function getPendingBrowserHandoffs(telegramId:string,limit=20):Promise<PendingBrowserHandoff[]>{
  const found:PendingBrowserHandoff[]=[]
  // Exclude known retired states before limiting, so old closed tasks cannot
  // bury a live takeover or force unbounded sequential reads on every page.
  const {data,error}=await supabaseAdmin.from('agent_runs')
    .select('id,title,summary,status,error,metadata_json,updated_at')
    .eq('telegram_id',String(telegramId)).eq('status','paused')
    .contains('metadata_json',{handoff:{}})
    .or('metadata_json->handoff->>takeoverUrl.not.is.null,metadata_json->handoff->>providerUrl.not.is.null')
    .or('metadata_json->>state.is.null,metadata_json->>state.not.in.(closed_stale,closed)')
    .or('summary.is.null,summary.neq.Superseded by duplicate mission submission')
    .or('error.is.null,error.not.in.(stale_provider_access_limited,background_browser_resume_expired,stale_run_recovered,background_browser_actor_missing)')
    .order('updated_at',{ascending:false}).order('id',{ascending:false}).limit(limit)
  if(error)throw new Error('browser_handoff_lookup_failed')
  for(const row of data||[]){
    const handoff=row.metadata_json?.handoff
    if(!isActionablePause(row)||!handoff||!(handoff.takeoverUrl||(handoff.mode==='device'&&handoff.providerUrl)))continue
    found.push({id:String(row.id),title:String(row.title||'Browser task'),
      summary:String(row.summary||'Choose Take control to complete the provider step.'),
      updatedAt:row.updated_at||null})
  }
  return found
}

