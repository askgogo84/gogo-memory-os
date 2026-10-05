import {supabaseAdmin} from '@/lib/supabase-admin'
import {isActionablePause} from './run-state'

export type PendingBrowserHandoff={id:string;title:string;summary:string;updatedAt:string|null}

// Read the actual paused browser handoffs separately from recent activity.
// A long conversation must not push an unresolved Take control task out of
// the dashboard's Needs you panel.
export async function getPendingBrowserHandoffs(telegramId:string,limit=20):Promise<PendingBrowserHandoff[]>{
  const found:PendingBrowserHandoff[]=[]
  const pageSize=100
  for(let offset=0;found.length<limit;offset+=pageSize){
    // JSONB containment only admits handoff objects (not JSON null). Scan past
    // retired rows before applying the visible limit so older live tasks remain.
    const {data,error}=await supabaseAdmin.from('agent_runs')
      .select('id,title,summary,status,error,metadata_json,updated_at')
      .eq('telegram_id',String(telegramId)).eq('status','paused')
      .contains('metadata_json',{handoff:{}})
      .order('updated_at',{ascending:false}).order('id',{ascending:false})
      .range(offset,offset+pageSize-1)
    if(error)throw new Error('browser_handoff_lookup_failed')
    for(const row of data||[]){
      const handoff=row.metadata_json?.handoff
      if(!isActionablePause(row)||!handoff||!(handoff.takeoverUrl||(handoff.mode==='device'&&handoff.providerUrl)))continue
      found.push({id:String(row.id),title:String(row.title||'Browser task'),
        summary:String(row.summary||'Choose Take control to complete the provider step.'),
        updatedAt:row.updated_at||null})
      if(found.length===limit)break
    }
    if((data||[]).length<pageSize)break
  }
  return found
}

