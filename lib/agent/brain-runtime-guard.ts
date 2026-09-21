import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type InboundClaim = {
  id:string
  ownerToken:string
  duplicate:boolean
  status:'claimed'|'completed'|'failed'
  result?:Record<string,unknown>
}

export function inboundClaimNeedsRecovery(status:string, leaseUntil:string|null|undefined, nowMs=Date.now()){
  if(status==='failed')return true
  if(status!=='claimed')return false
  const leaseMs=leaseUntil?Date.parse(leaseUntil):NaN
  return !Number.isFinite(leaseMs)||leaseMs<=nowMs
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
    .select('id,status,result_json,owner_token,lease_until,external_user_id,telegram_id')
    .eq('surface',surface).eq('event_key',eventKey).maybeSingle()
  if(readError||!existing?.id)throw new Error(`inbound_event_duplicate_read_failed:${readError?.message||'unknown'}`)

  const existingStatus=String(existing.status||'claimed') as InboundClaim['status']
  const result=(existing.result_json&&typeof existing.result_json==='object')?existing.result_json:{}

  if(!inboundClaimNeedsRecovery(existingStatus,existing.lease_until)){
    return {
      id:String(existing.id),
      ownerToken:'',
      duplicate:true,
      status:existingStatus,
      result,
    }
  }

  const nowIso=new Date().toISOString()
  let reclaim=supabaseAdmin.from('agent_inbound_events').update({
    status:'claimed',
    owner_token:ownerToken,
    lease_until:leaseUntil,
    error:null,
    result_json:{},
    updated_at:nowIso,
    external_user_id:params.externalUserId?String(params.externalUserId):existing.external_user_id,
    telegram_id:params.telegramId!=null?String(params.telegramId):existing.telegram_id,
  }).eq('id',String(existing.id))

  if(existingStatus==='failed'){
    reclaim=reclaim.eq('status','failed')
  }else{
    reclaim=reclaim.eq('status','claimed')
    reclaim=existing.lease_until
      ? reclaim.lte('lease_until',nowIso)
      : reclaim.is('lease_until',null)
  }

  const {data:reclaimed,error:reclaimError}=await reclaim.select('id,status').maybeSingle()
  if(reclaimError)throw new Error(`inbound_event_reclaim_failed:${reclaimError.message}`)

  if(reclaimed?.id){
    return {id:String(reclaimed.id),ownerToken,duplicate:false,status:'claimed'}
  }

  const {data:current,error:currentError}=await supabaseAdmin.from('agent_inbound_events')
    .select('id,status,result_json')
    .eq('surface',surface).eq('event_key',eventKey).maybeSingle()
  if(currentError||!current?.id)throw new Error(`inbound_event_reclaim_race_read_failed:${currentError?.message||'unknown'}`)

  return {
    id:String(current.id),
    ownerToken:'',
    duplicate:true,
    status:String(current.status||'claimed') as InboundClaim['status'],
    result:(current.result_json&&typeof current.result_json==='object')?current.result_json:{},
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
