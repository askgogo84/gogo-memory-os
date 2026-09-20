import { supabaseAdmin } from '@/lib/supabase-admin'
import { decryptVaultValue, encryptVaultValue, vaultHint } from '@/lib/security/vault-crypto'
import { normalizeVaultDomain, vaultDomainAllowed } from './domain-policy'

export type VaultCredentialMetadata={
  id:string
  provider:string
  accountLabel:string
  usernameHint:string
  allowedDomains:string[]
  status:'active'|'needs_reauth'|'revoked'
  lastUsedAt:string|null
  updatedAt:string|null
}

function clean(value:unknown,max=200){
  return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)
}

async function audit(params:{telegramId:string;credentialId?:string|null;provider?:string;domain?:string;eventType:string;outcome?:string;metadata?:Record<string,unknown>}){
  const {error}=await supabaseAdmin.from('vault_audit').insert({
    telegram_id:params.telegramId,
    credential_id:params.credentialId||null,
    provider:clean(params.provider,80),
    domain:normalizeVaultDomain(params.domain||''),
    event_type:clean(params.eventType,80),
    outcome:clean(params.outcome||'ok',40),
    metadata_json:params.metadata||{},
  })
  if(error)console.error('VAULT_AUDIT_FAILED:',error.message)
}

export async function listVaultCredentials(telegramId:string):Promise<VaultCredentialMetadata[]>{
  const {data,error}=await supabaseAdmin.from('vault_credentials')
    .select('id,provider,account_label,username_hint,allowed_domains,status,last_used_at,updated_at')
    .eq('telegram_id',String(telegramId))
    .neq('status','revoked')
    .order('updated_at',{ascending:false})
  if(error)throw new Error(`vault_list_failed:${error.message}`)
  return (data||[]).map((row:any)=>({
    id:String(row.id),provider:String(row.provider||''),accountLabel:String(row.account_label||''),
    usernameHint:String(row.username_hint||''),allowedDomains:Array.isArray(row.allowed_domains)?row.allowed_domains:[],
    status:row.status,lastUsedAt:row.last_used_at||null,updatedAt:row.updated_at||null,
  }))
}

export async function saveVaultCredential(params:{
  telegramId:string
  provider:string
  accountLabel:string
  username:string
  secret:string
  allowedDomains:string[]
  metadata?:Record<string,unknown>
}){
  const telegramId=String(params.telegramId)
  const provider=clean(params.provider,80).toLowerCase()
  const accountLabel=clean(params.accountLabel,120)
  const username=String(params.username||'').trim()
  const secret=String(params.secret||'')
  const allowedDomains=Array.from(new Set((params.allowedDomains||[]).map(normalizeVaultDomain).filter(Boolean))).slice(0,12)
  if(!provider||!accountLabel||!username||!secret||!allowedDomains.length)throw new Error('vault_credential_invalid')

  const row={
    telegram_id:telegramId,
    provider,
    account_label:accountLabel,
    username_hint:vaultHint(username),
    username_ciphertext:encryptVaultValue(username),
    secret_ciphertext:encryptVaultValue(secret),
    allowed_domains:allowedDomains,
    status:'active',
    key_version:1,
    metadata_json:params.metadata||{},
    updated_at:new Date().toISOString(),
  }
  const {data,error}=await supabaseAdmin.from('vault_credentials')
    .upsert(row,{onConflict:'telegram_id,provider,account_label'})
    .select('id,provider,account_label,username_hint,allowed_domains,status,last_used_at,updated_at')
    .single()
  if(error||!data?.id)throw new Error(`vault_save_failed:${error?.message||'unknown'}`)
  await audit({telegramId,credentialId:String(data.id),provider,domain:allowedDomains[0],eventType:'credential_saved'})
  return {
    id:String(data.id),provider:String(data.provider),accountLabel:String(data.account_label),
    usernameHint:String(data.username_hint),allowedDomains:data.allowed_domains||[],status:data.status,
    lastUsedAt:data.last_used_at||null,updatedAt:data.updated_at||null,
  } as VaultCredentialMetadata
}

export async function removeVaultCredential(telegramId:string,credentialId:string){
  const {data,error}=await supabaseAdmin.from('vault_credentials')
    .update({status:'revoked',username_ciphertext:'',secret_ciphertext:'',updated_at:new Date().toISOString()})
    .eq('telegram_id',String(telegramId)).eq('id',String(credentialId))
    .select('id,provider').maybeSingle()
  if(error)throw new Error(`vault_remove_failed:${error.message}`)
  if(!data)return false
  await audit({telegramId:String(telegramId),credentialId:String(data.id),provider:String(data.provider||''),eventType:'credential_removed'})
  return true
}

export async function resolveVaultCredentialForDomain(params:{telegramId:string;credentialId:string;domain:string}){
  const telegramId=String(params.telegramId)
  const domain=normalizeVaultDomain(params.domain)
  if(!domain)throw new Error('vault_domain_invalid')
  const {data,error}=await supabaseAdmin.from('vault_credentials')
    .select('id,provider,account_label,username_ciphertext,secret_ciphertext,allowed_domains,status')
    .eq('telegram_id',telegramId).eq('id',String(params.credentialId)).maybeSingle()
  if(error)throw new Error(`vault_read_failed:${error.message}`)
  if(!data||data.status!=='active')throw new Error('vault_credential_unavailable')
  const allowed=Array.isArray(data.allowed_domains)?data.allowed_domains:[]
  if(!vaultDomainAllowed(domain,allowed)){
    await audit({telegramId,credentialId:String(data.id),provider:String(data.provider||''),domain,eventType:'credential_domain_denied',outcome:'denied'})
    throw new Error('vault_domain_not_allowed')
  }

  const username=decryptVaultValue(data.username_ciphertext)
  const secret=decryptVaultValue(data.secret_ciphertext)
  await supabaseAdmin.from('vault_credentials').update({last_used_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',data.id)
  await audit({telegramId,credentialId:String(data.id),provider:String(data.provider||''),domain,eventType:'credential_resolved'})
  return {credentialId:String(data.id),provider:String(data.provider||''),accountLabel:String(data.account_label||''),username,secret,domain}
}
