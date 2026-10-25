import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeVaultDomain } from './domain-policy'

export type VaultSessionMetadata={
  id:string
  provider:string
  domain:string
  credentialId:string|null
  sandboxName:string
  profileGeneration:string
  status:'active'|'needs_reauth'|'human_challenge'|'expired'|'revoked'
  authMethod:'session'|'vault_credential'|'human_handoff'|'oauth'
  lastUsedAt:string|null
  expiresAt:string|null
  updatedAt:string|null
}

function safe(value:unknown,max=160){
  return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)
}

export async function upsertVaultSession(params:{
  telegramId:string
  provider?:string|null
  domain:string
  credentialId?:string|null
  sandboxName:string
  profileGeneration:string
  status?:VaultSessionMetadata['status']
  authMethod?:VaultSessionMetadata['authMethod']
  expiresAt?:string|null
  metadata?:Record<string,unknown>
}){
  const telegramId=String(params.telegramId)
  const domain=normalizeVaultDomain(params.domain)
  if(!telegramId||!domain||!params.sandboxName||!params.profileGeneration)throw new Error('vault_session_invalid')
  const now=new Date().toISOString()
  const row={
    telegram_id:telegramId,
    provider:safe(params.provider,80),
    domain,
    credential_id:params.credentialId||null,
    sandbox_name:safe(params.sandboxName,180),
    profile_generation:safe(params.profileGeneration,40),
    status:params.status||'active',
    auth_method:params.authMethod||'session',
    last_used_at:now,
    expires_at:params.expiresAt||null,
    metadata_json:params.metadata||{},
    updated_at:now,
  }
  const {data,error}=await supabaseAdmin.from('vault_sessions')
    .upsert(row,{onConflict:'telegram_id,domain,sandbox_name'})
    .select('id,provider,domain,credential_id,sandbox_name,profile_generation,status,auth_method,last_used_at,expires_at,updated_at')
    .single()
  if(error||!data?.id)throw new Error(`vault_session_upsert_failed:${error?.message||'unknown'}`)
  return map(data)
}

export async function listVaultSessions(telegramId:string):Promise<VaultSessionMetadata[]>{
  const {data,error}=await supabaseAdmin.from('vault_sessions')
    .select('id,provider,domain,credential_id,sandbox_name,profile_generation,status,auth_method,last_used_at,expires_at,updated_at')
    .eq('telegram_id',String(telegramId))
    .neq('status','revoked')
    .order('updated_at',{ascending:false})
  if(error)throw new Error(`vault_session_list_failed:${error.message}`)
  return (data||[]).map(map)
}

export async function markVaultSessionStatus(params:{
  telegramId:string
  domain:string
  sandboxName:string
  status:VaultSessionMetadata['status']
}){
  const domain=normalizeVaultDomain(params.domain)
  const {error}=await supabaseAdmin.from('vault_sessions').update({
    status:params.status,updated_at:new Date().toISOString(),
  }).eq('telegram_id',String(params.telegramId)).eq('domain',domain).eq('sandbox_name',String(params.sandboxName))
  if(error)throw new Error(`vault_session_status_failed:${error.message}`)
}

function map(row:any):VaultSessionMetadata{
  return {
    id:String(row.id),provider:String(row.provider||''),domain:String(row.domain||''),
    credentialId:row.credential_id?String(row.credential_id):null,
    sandboxName:String(row.sandbox_name||''),profileGeneration:String(row.profile_generation||''),
    status:row.status,authMethod:row.auth_method,lastUsedAt:row.last_used_at||null,
    expiresAt:row.expires_at||null,updatedAt:row.updated_at||null,
  }
}
