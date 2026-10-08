import { clearFollowupState, getLatestFollowupState, isFreshFollowupState, saveFollowupState } from '@/lib/bot/handlers/followup-state'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { findVaultProviderForDomain, findVaultProviderInText } from '@/lib/vault/providers'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { runBrowserCommand, type BrowserCommand } from './browser-command'

const FOLLOWUP_KIND='external_account_create'
const EMAIL=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

export type ExternalAccountRequest={
  service:string
  email:string|null
  url:string|null
}

function cleanService(value:string){
  return String(value||'')
    .replace(/\b(?:website|site|app)\b/gi,' ')
    .replace(/\s+/g,' ')
    .trim()
    .replace(/[.,!?;:]+$/,'')
    .slice(0,80)
}

function extractEmail(text:string){
  const match=String(text||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?match[0]:null
}

function extractUrl(text:string){
  const match=String(text||'').match(/https?:\/\/[^\s<>)\]}]+/i)
  if(!match)return null
  try{
    const url=new URL(match[0])
    if(url.protocol!=='https:'||url.username||url.password)return null
    return url.toString()
  }catch{return null}
}

export function parseExternalAccountRequest(text:string):ExternalAccountRequest|null{
  const raw=String(text||'').replace(/\s+/g,' ').trim()
  if(!raw)return null
  const lower=raw.toLowerCase()
  const createAccount=/\b(?:create|open|make)\s+(?:me\s+)?(?:an?\s+)?account\b/i.test(raw)
  const signupAccount=/\b(?:sign\s*up|register)\b/i.test(raw)&&/\baccount\b/i.test(raw)
  if(!createAccount&&!signupAccount)return null
  if(/\b(?:buy|purchase|checkout|pay|payment|subscribe\s+to\s+(?:a\s+)?paid)\b/i.test(lower))return null

  const byCreate=raw.match(/\b(?:create|open|make)\s+(?:me\s+)?(?:an?\s+)?account\s+(?:on|at|with|for)\s+(.+?)(?=\s+(?:using|with|and|then|please|for\s+me)\b|[.!?;,]|$)/i)
  const byLogin=raw.match(/\b(?:log\s*in|login|go)\s+to\s+(.+?)(?=\s+(?:and|then)\s+(?:create|open|make|sign\s*up|register)\b|[.!?;,]|$)/i)
  const bySignup=raw.match(/\b(?:sign\s*up|register)\s+(?:me\s+)?(?:for\s+an?\s+account\s+)?(?:on|at|with|for)\s+(.+?)(?=\s+(?:using|with|and|then|please)\b|[.!?;,]|$)/i)
  const explicitUrl=extractUrl(raw)
  let service=cleanService(byLogin?.[1]||bySignup?.[1]||byCreate?.[1]||'')
  if(/^me$/i.test(service))service=''
  if(!service&&explicitUrl){
    try{service=new URL(explicitUrl).hostname.replace(/^www\./,'')}catch{}
  }
  if(!service)return null
  return {service,email:extractEmail(raw),url:explicitUrl}
}

function emailOnly(text:string){return EMAIL.test(String(text||'').trim())}
function urlOnly(text:string){return /^https:\/\/\S+$/i.test(String(text||'').trim())}
function norm(value:unknown){return String(value||'').replace(/\s+/g,' ').trim()}

async function pendingStillBound(telegramId:number,originText:string){
  const {data}=await supabaseAdmin.from('conversations')
    .select('content')
    .eq('telegram_id',telegramId)
    .eq('role','user')
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle()
  return norm(data?.content)===norm(originText)
}

function trustedTarget(request:ExternalAccountRequest){
  const byText=findVaultProviderInText(request.service)
  if(byText){
    if(request.url){
      const host=new URL(request.url).hostname.replace(/^www\./,'')
      const byDomain=findVaultProviderForDomain(host)
      if(!byDomain||byDomain.key!==byText.key)return null
    }
    if(byText.signupUrl)return {provider:byText,url:byText.signupUrl}
    if(request.url)return {provider:byText,url:request.url}
    return null
  }
  if(!request.url)return null
  const host=new URL(request.url).hostname.replace(/^www\./,'')
  const byDomain=findVaultProviderForDomain(host)
  if(byDomain)return {provider:byDomain,url:byDomain.signupUrl||request.url}
  // Unknown providers are allowed only when the USER supplied the exact https URL.
  // We never auto-discover a consequential target from search/name similarity.
  return {provider:null,url:request.url}
}

async function prepareExternalAccount(params:{actor:AgentActor;surface:AgentSurface;request:ExternalAccountRequest;originText:string}){
  const email=params.request.email
  if(!email){
    await saveFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND,{
      service:params.request.service,url:params.request.url,stage:'email',originText:params.originText,
    })
    return {text:`Which email should I use for the ${params.request.service} account?`,status:'paused',handledBy:'external-account-objective'}
  }

  const target=trustedTarget(params.request)
  if(!target){
    await saveFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND,{
      service:params.request.service,email,stage:'url',originText:params.originText,
    })
    return {text:`I have the account objective and email. Send me the official ${params.request.service} website URL so I can continue safely.`,status:'paused',handledBy:'external-account-objective'}
  }

  const url=target.url
  const host=new URL(url).hostname.replace(/^www\./,'')
  const command:BrowserCommand={
    url,
    mode:'execute',
    risk:'high',
    approvalAction:'submit_form',
    objective:[
      `Create an account on ${params.request.service} (${host}) using email ${email}.`,
      'Use a sensible username derived from the email local-part if the site requires one and it is available.',
      'Do not spend money, start a paid subscription, or bypass any CAPTCHA, OTP, passkey, email-verification, or other human-auth step.',
      'If credentials are required, use the owner-bound Vault path; never expose secrets in chat.',
      'Pause for Take Control at human-only verification boundaries and resume this same run afterward.',
      'Only claim success after the provider visibly confirms the account was created.',
    ].join(' '),
  }
  const result=await runBrowserCommand({actor:params.actor,surface:params.surface,command})
  if(result?.status==='waiting_approval'){
    return {...result,text:`Ready to create the ${params.request.service} account on ${host} using ${email}. Creating it may accept the site's terms/code of conduct and submit your details. Reply *APPROVE* to continue or *REJECT* to stop.`,handledBy:'external-account-objective'}
  }
  return result?{...result,handledBy:'external-account-objective'}:null
}

export async function tryRunExternalAccountFlow(params:{actor:AgentActor;surface:AgentSurface;text:string;messageId?:string|number|null}){
  const pending=await getLatestFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND)
  if(pending&&isFreshFollowupState(pending,30)){
    const payload=pending.payload||{}
    const bound=await pendingStillBound(params.actor.legacyTelegramId,String(payload.originText||''))
    if(!bound){
      await clearFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND)
    }else if(payload.stage==='email'&&emailOnly(params.text)){
      await clearFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND)
      return prepareExternalAccount({
        actor:params.actor,surface:params.surface,originText:String(params.text).trim(),
        request:{service:String(payload.service||''),email:String(params.text).trim(),url:payload.url?String(payload.url):null},
      })
    }else if(payload.stage==='url'&&urlOnly(params.text)){
      await clearFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND)
      return prepareExternalAccount({
        actor:params.actor,surface:params.surface,originText:String(payload.originText||''),
        request:{service:String(payload.service||''),email:String(payload.email||''),url:String(params.text).trim()},
      })
    }else if(!parseExternalAccountRequest(params.text)){
      await clearFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND)
    }
  }

  const request=parseExternalAccountRequest(params.text)
  if(!request)return null
  return prepareExternalAccount({actor:params.actor,surface:params.surface,request,originText:params.text})
}
