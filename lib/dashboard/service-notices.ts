import {supabaseAdmin} from '@/lib/supabase-admin'

export type ServiceNotice={id:string;title:string;summary:string;threadId:string;messageId:string|null;updatedAt:string|null}
export type ServiceNotices={items:ServiceNotice[];total:number;unavailable:boolean}
export const EMPTY_SERVICE_NOTICES:ServiceNotices={items:[],total:0,unavailable:false}

/** Read saved attention only: dashboard polling must never sync Gmail or mutate loops. */
export async function getServiceNotices(telegramId:string|number):Promise<ServiceNotices>{
  const owner=String(telegramId??'').trim()
  if(!owner)throw new Error('service_notice_owner_required')
  const {data,count,error}=await supabaseAdmin.from('agent_open_loops')
    .select('id,title,summary,source_id,source_refs,last_seen_at,updated_at',{count:'exact'})
    .eq('telegram_id',owner).eq('status','active').eq('kind','commitment').eq('source_type','gmail_service_notice')
    .order('priority',{ascending:false}).order('updated_at',{ascending:false}).limit(50)
  if(error)throw new Error('service_notice_read_failed')
  const seen=new Set<string>()
  const items:ServiceNotice[]=[]
  for(const row of data||[]){
    const threadId=String(row.source_id||'')
    if(!threadId||seen.has(threadId))continue
    seen.add(threadId)
    const refs=Array.isArray(row.source_refs)?row.source_refs:[]
    const message=refs.find((ref:{type?:unknown;id?:unknown}|null)=>ref?.type==='gmail_message'&&typeof ref.id==='string')
    items.push({id:String(row.id),title:String(row.title||'Review service notice').slice(0,240),summary:String(row.summary||'').slice(0,700),threadId,messageId:typeof message?.id==='string'?message.id:null,updatedAt:row.last_seen_at||row.updated_at||null})
  }
  return {items,total:Math.max(items.length,Number(count??items.length)),unavailable:false}
}

/** Server pages retain other panels while making a failed notice read explicit. */
export async function getServiceNoticesForPage(telegramId:string|number):Promise<ServiceNotices>{
  try{return await getServiceNotices(telegramId)}
  catch{return {items:[],total:0,unavailable:true}}
}
