import { clearFollowupState, getLatestFollowupState, isFreshFollowupState, saveFollowupState } from '@/lib/bot/handlers/followup-state'
import { searchWeb } from '@/lib/services/web-search'
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
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null
    return url.toString()
  }catch{return null}
}

export function parseExternalAccountRequest(text:string):ExternalAccountRequest|null{
  const raw=String(text||'').replace(/\s+/g,' ').trim()
  if(!raw)return null
  const lower=raw.toLowerCase()
  const wantsCreate=/\b(?:create|open|make)\s+(?:me\s+)?(?:an?\s+)?account\b/i.test(raw)||/\b(?:sign\s*up|register)\b/i.test(raw)
  if(!wantsCreate)return null
  if(/\b(?:buy|purchase|checkout|pay|payment|subscribe\s+to\s+(?:a\s+)?paid)\b/i.test(lower))return null

  const byCreate=raw.match(/\b(?:create|open|make)\s+(?:me\s+)?(?:an?\s+)?account\s+(?:on|at|with|for)\s+(.+?)(?=\s+(?:using|with|and|then|please|for\s+me)\b|[.!?;,]|$)/i)
  const byLogin=raw.match(/\b(?:log\s*in|login|go)\s+to\s+(.+?)(?=\s+(?:and|then)\s+(?:create|open|make|sign\s*up|register)\b|[.!?;,]|$)/i)
  const bySignup=raw.match(/\b(?:sign\s*up|register)\s+(?:me\s+)?(?:on|at|with|for)\s+(.+?)(?=\s+(?:using|with|and|then|please)\b|[.!?;,]|$)/i)
  const explicitUrl=extractUrl(raw)
  let service=cleanService(byLogin?.[1]||bySignup?.[1]||byCreate?.[1]||'')
  if(/^me$/i.test(service))service=''
  if(!service&&explicitUrl){
    try{service=new URL(explicitUrl).hostname.replace(/^www\./,'')}catch{}
  }
  if(!service)return null
  return {service,email:extractEmail(raw),url:explicitUrl}
}

function compact(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,'')}
function serviceTokens(service:string){return service.toLowerCase().split(/[^a-z0-9]+/).filter(token=>token.length>=3)}
const DENY_HOSTS=['google.com','bing.com','duckduckgo.com','wikipedia.org','reddit.com','facebook.com','instagram.com','linkedin.com','x.com','twitter.com']

export function resolveOfficialCandidateFromSearchText(service:string,searchText:string):string|null{
  const serviceCompact=compact(service)
  const tokens=serviceTokens(service)
  const sources=[...String(searchText||'').matchAll(/Source:\s*(https?:\/\/[^\s]+)/gi)].map(match=>match[1])
  const candidates=sources.map(value=>{
    try{
      const url=new URL(value)
      if(url.protocol!=='https:'||url.username||url.password)return null
      const host=url.hostname.toLowerCase().replace(/^www\./,'')
      if(DENY_HOSTS.some(blocked=>host===blocked||host.endsWith('.'+blocked)))return null
      const hostCompact=compact(host)
      let score=0
      if(serviceCompact.length>=5&&hostCompact.includes(serviceCompact))score+=10
      for(const token of tokens)if(hostCompact.includes(token))score+=2
      if(url.pathname==='/'||url.pathname==='')score+=1
      return score>0?{url:url.toString(),score}:null
    }catch{return null}
  }).filter(Boolean) as Array<{url:string;score:number}>
  candidates.sort((a,b)=>b.score-a.score)
  return candidates[0]?.url||null
}

function emailOnly(text:string){return EMAIL.test(String(text||'').trim())}
function urlOnly(text:string){return /^https?:\/\/\S+$/i.test(String(text||'').trim())}

async function prepareExternalAccount(params:{actor:AgentActor;surface:AgentSurface;request:ExternalAccountRequest}){
  const email=params.request.email
  if(!email){
    await saveFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND,{service:params.request.service,url:params.request.url,stage:'email'})
    return {text:`Which email should I use for the ${params.request.service} account?`,status:'paused',handledBy:'external-account-objective'}
  }

  let url=params.request.url
  if(!url){
    const search=await searchWeb(`${params.request.service} official website sign up`)
    url=resolveOfficialCandidateFromSearchText(params.request.service,search)
  }
  if(!url){
    await saveFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND,{service:params.request.service,email,stage:'url'})
    return {text:`I have the account objective and email. Send me the official ${params.request.service} website URL so I can continue safely.`,status:'paused',handledBy:'external-account-objective'}
  }

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

export async function tryRunExternalAccountFlow(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const pending=await getLatestFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND)
  if(pending&&isFreshFollowupState(pending,30)){
    const payload=pending.payload||{}
    if(payload.stage==='email'&&emailOnly(params.text)){
      await clearFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND)
      return prepareExternalAccount({actor:params.actor,surface:params.surface,request:{service:String(payload.service||''),email:String(params.text).trim(),url:payload.url?String(payload.url):null}})
    }
    if(payload.stage==='url'&&urlOnly(params.text)){
      await clearFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND)
      return prepareExternalAccount({actor:params.actor,surface:params.surface,request:{service:String(payload.service||''),email:String(payload.email||''),url:String(params.text).trim()}})
    }
  }

  const request=parseExternalAccountRequest(params.text)
  if(!request)return null
  return prepareExternalAccount({actor:params.actor,surface:params.surface,request})
}
