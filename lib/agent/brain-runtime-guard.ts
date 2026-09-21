import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type InboundClaim = {
  id:string
  ownerToken:string
  duplicate:boolean
  status:'claimed'|'completed'|'failed'
  result?:Record<string,unknown>
}

export async function claimInboundEvent(params:{
  surface:string
  eventKey:string
  externalUserId?:string|null
  telegramId?:string|number|null
  leaseSeconds?:number
}):Promise<InboundClaim>{
  const surface=String(params.surface||'').trim()
  const eventKey=String(params.eventKey||'').trim()
  if(!surface||!eventKey)throw new Error('inbound_event_key_required')
  const ownerToken=randomUUID()
  const leaseUntil=new Date(Date.now()+Math.max(10,Math.min(Number(params.leaseSeconds||90),600))*1000).toISOString()

  const {data,error}=await supabaseAdmin.from('agent_inbound_events').insert({
    surface,event_key:eventKey,
    external_user_id:params.externalUserId?String(params.externalUserId):null,
    telegram_id:params.telegramId!=null?String(params.telegramId):null,
    status:'claimed',owner_token:ownerToken,lease_until:leaseUntil,
  }).select('id,status,result_json').maybeSingle()

  if(!error&&data?.id){
    return {id:String(data.id),ownerToken,duplicate:false,status:'claimed'}
  }

  if(String((error as any)?.code||'')!=='23505')throw new Error(`inbound_event_claim_failed:${error?.message||'unknown'}`)

  const {data:existing,error:readError}=await supabaseAdmin.from('agent_inbound_events')
    .select('id,status,result_json,owner_token,lease_until')
    .eq('surface',surface).eq('event_key',eventKey).maybeSingle()
  if(readError||!existing?.id)throw new Error(`inbound_event_duplicate_read_failed:${readError?.message||'unknown'}`)

  return {
    id:String(existing.id),
    ownerToken:String(existing.owner_token||''),
    duplicate:true,
    status:String(existing.status||'claimed') as InboundClaim['status'],
    result:(existing.result_json&&typeof existing.result_json==='object')?existing.result_json:{},
  }
}

export async function completeInboundEvent(params:{id:string;ownerToken:string;result?:Record<string,unknown>}){
  const {data,error}=await supabaseAdmin.from('agent_inbound_events').update({
    status:'completed',result_json:params.result||{},error:null,lease_until:null,updated_at:new Date().toISOString(),
  }).eq('id',params.id).eq('owner_token',params.ownerToken).eq('status','claimed').select('id').maybeSingle()
  if(error)throw new Error(`inbound_event_complete_failed:${error.message}`)
  if(!data?.id)throw new Error('inbound_event_claim_lost')
}

export async function failInboundEvent(params:{id:string;ownerToken:string;error:string}){
  const {data,error}=await supabaseAdmin.from('agent_inbound_events').update({
    status:'failed',error:String(params.error||'inbound_event_failed').slice(0,500),lease_until:null,updated_at:new Date().toISOString(),
  }).eq('id',params.id).eq('owner_token',params.ownerToken).eq('status','claimed').select('id').maybeSingle()
  if(error)throw new Error(`inbound_event_fail_failed:${error.message}`)
  if(!data?.id)throw new Error('inbound_event_claim_lost')
}

export async function acquireBrainUserLease(userKey:string,leaseSeconds=90){
  const ownerToken=randomUUID()
  const {data,error}=await supabaseAdmin.rpc('try_acquire_brain_user_lease',{
    p_user_key:String(userKey),p_owner_token:ownerToken,p_lease_seconds:leaseSeconds,
  })
  if(error)throw new Error(`brain_user_lease_failed:${error.message}`)
  return data===true?{ownerToken}:null
}

export async function releaseBrainUserLease(userKey:string,ownerToken:string){
  const {data,error}=await supabaseAdmin.rpc('release_brain_user_lease',{
    p_user_key:String(userKey),p_owner_token:String(ownerToken),
  })
  if(error)throw new Error(`brain_user_lease_release_failed:${error.message}`)
  return data===true
}
