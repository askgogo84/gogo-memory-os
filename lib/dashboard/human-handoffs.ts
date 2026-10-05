import {supabaseAdmin} from '@/lib/supabase-admin'
import {isActionablePause} from './run-state'

export type PendingBrowserHandoff={id:string;title:string;summary:string;updatedAt:string|null}

// Read the actual paused browser handoffs separately from recent activity.
// A long conversation must not push an unresolved Take control task out of
// the dashboard's Needs you panel.
export async function getPendingBrowserHandoffs(telegramId:string,limit=20):Promise<PendingBrowserHandoff[]>{
  const {data,error}=await supabaseAdmin.from('agent_runs')
    .select('id,title,summary,status,error,metadata_json,updated_at')
    .eq('telegram_id',String(telegramId)).eq('type','secure_browser').eq('status','paused')
    .not('metadata_json->handoff','is',null)
    .order('updated_at',{ascending:false}).limit(limit)
  if(error)throw new Error('browser_handoff_lookup_failed')
  return (data||[]).filter(isActionablePause).map(row=>({
    id:String(row.id),title:String(row.title||'Browser task'),
    summary:String(row.summary||'Choose Take control to complete the provider step.'),
    updatedAt:row.updated_at||null,
  }))
}
