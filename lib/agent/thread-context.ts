import { supabaseAdmin } from '@/lib/supabase-admin'

export async function resolveThreadForUser(telegramId:string,value:unknown){
  const id=String(value||'').trim()
  if(!id)return null
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('invalid_thread')
  const {data,error}=await supabaseAdmin.from('agent_threads').select('id,title,context_json').eq('id',id).eq('telegram_id',telegramId).eq('status','active').maybeSingle()
  if(error)throw new Error(`thread_read_failed:${error.message}`)
  if(!data)throw new Error('thread_not_found')
  return {id:String(data.id),title:String(data.title),context:(data.context_json||{}) as Record<string,unknown>}
}

export async function attachRunToThread(telegramId:string,runId:unknown,threadId:string|null){
  if(!threadId||!runId)return
  const id=String(runId);if(!/^[0-9a-f-]{36}$/i.test(id))return
  await supabaseAdmin.from('agent_runs').update({thread_id:threadId,updated_at:new Date().toISOString()}).eq('id',id).eq('telegram_id',telegramId)
  await supabaseAdmin.from('agent_threads').update({updated_at:new Date().toISOString()}).eq('id',threadId).eq('telegram_id',telegramId)
}
