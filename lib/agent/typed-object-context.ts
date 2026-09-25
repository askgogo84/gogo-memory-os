import { supabaseAdmin } from '@/lib/supabase-admin'

export type ObjectDomain='calendar'|'reminders'|'email'|'watchers'|'travel'|'browser'|'files'
export type TypedObject={id:string;title:string}
export type TypedContext={domain:ObjectDomain;items:TypedObject[];selectedId:string|null;at:string}
const domains=['calendar','reminders','email','watchers','travel','browser','files']
export async function rememberTypedObjects(telegramId:number,domain:ObjectDomain,items:TypedObject[],selectedId?:string|null){
  const objects=items.filter(o=>o.id).slice(0,50).map(o=>({id:String(o.id),title:String(o.title||'').slice(0,240)}))
  const {error}=await supabaseAdmin.from('agent_activity').insert({telegram_id:String(telegramId),event_type:'typed_object_context',message:'Typed object selection updated.',metadata_json:{domain,items:objects,selectedId:selectedId===undefined?(objects.length===1?objects[0].id:null):selectedId,at:new Date().toISOString()}})
  if(error)throw new Error('typed_context_write_failed')
}
export async function latestTypedContext(telegramId:number):Promise<TypedContext|null>{
  const {data,error}=await supabaseAdmin.from('agent_activity').select('metadata_json,created_at').eq('telegram_id',String(telegramId)).eq('event_type','typed_object_context').order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw new Error('typed_context_read_failed')
  const m=data?.metadata_json,age=Date.now()-Date.parse(String(m?.at||''))
  if(!m||!domains.includes(m.domain)||!Array.isArray(m.items)||!Number.isFinite(age)||age<0||age>30*60000)return null
  if(m.items.length>50||m.items.some((o:any)=>!o||typeof o.id!=='string'||!o.id||typeof o.title!=='string')||new Set(m.items.map((o:any)=>o.id)).size!==m.items.length)return null
  if(m.selectedId!==null&&(typeof m.selectedId!=='string'||!m.items.some((o:any)=>o.id===m.selectedId)))return null
  return m as TypedContext
}
export function normalizedObjectTitle(value:string){return String(value||'').normalize('NFKC').toLowerCase().replace(/^(?:the |my )?(?:an? )?(?:calendar )?(?:event|meeting|reminder) (?:called |named )?/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
export function typedOrdinal(text:string){const m=text.match(/\b(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+(?:one|event|meeting|reminder)\b/i);if(!m)return null;const words=['first','second','third','fourth','fifth'];return words.includes(m[1].toLowerCase())?words.indexOf(m[1].toLowerCase()):parseInt(m[1],10)-1}
export function selectedTypedObject(context:TypedContext|null,text:string){
  if(!context)return null
  const ordinal=typedOrdinal(text)
  if(ordinal!==null)return context.items[ordinal]||null
  return context.items.find(o=>o.id===context.selectedId)||null
}

// A typed foreign object is a hard boundary for mutation routing. Its owner may
// handle it or clarify; a generic time verb must never convert it to a reminder.
export function typedMutationOwner(context:TypedContext|null,text:string):ObjectDomain|null{
  if(!context)return null
  if(/\b(?:it|that|this|selected|one)\b/i.test(text)||typedOrdinal(text)!==null)return context.domain
  return null
}
