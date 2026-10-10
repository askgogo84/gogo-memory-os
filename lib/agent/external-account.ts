import { clearFollowupState, saveFollowupState } from '@/lib/bot/handlers/followup-state'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { VAULT_PROVIDERS, findVaultProviderForDomain, findVaultProviderInText, type VaultProvider } from '@/lib/vault/providers'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { runBrowserCommand, type BrowserCommand } from './browser-command'
import { readAccountRequestWithModel } from './account-intent-model'
import { mayBeAccountRequest, mentionsExternalAccountCreation, parseAccountProfile, parseExternalAccountRequest, parseLooseAccountProfile, type ExternalAccountRequest } from './external-account-intent'

// Intent detection is pure and shared with the classifier; re-exported so existing
// importers (WhatsApp route, regression scripts) keep a single entry point.
export { mentionsExternalAccountCreation, parseAccountProfile, parseExternalAccountRequest, parseLooseAccountProfile, mayBeAccountRequest, type ExternalAccountRequest }

const FOLLOWUP_KIND='external_account_create'
const FOLLOWUP_MAX_MINUTES=30
const EMAIL=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

function emailOnly(text:string){return EMAIL.test(String(text||'').trim())}
function urlOnly(text:string){return /^https:\/\/\S+$/i.test(String(text||'').trim())}
function norm(value:unknown){return String(value||'').replace(/\s+/g,' ').trim()}
function errorText(error:unknown){return String((error as {message?:unknown})?.message||error).slice(0,200)}

type PendingFollowup={type?:unknown;kind?:unknown;created_at?:string;payload?:Record<string,unknown>}

/**
 * True when this message could start or continue an external-account objective: an
 * account request (named or vague), or a bare email/https URL that may answer a pending
 * one. The WhatsApp route applies the same checks inline before resolving the actor.
 */
export function isExternalAccountCandidate(text:string){
  return Boolean(parseExternalAccountRequest(text))||mentionsExternalAccountCreation(text)||emailOnly(text)||urlOnly(text)||Boolean(parseAccountProfile(text))||Boolean(parseLooseAccountProfile(text))
}

const VAGUE_PROMPT='Which website or app should I create the account on? Reply with its name, for example: create an account on Hugging Face.'

// One read returns both our pending objective and the kind of the user's most recent
// pending question of ANY kind. A bare email/URL may only answer the latest question.
async function readPendingAccountFollowup(telegramId:number){
  const {data}=await supabaseAdmin
    .from('memories')
    .select('content, created_at')
    .eq('telegram_id',telegramId)
    .order('created_at',{ascending:false})
    .limit(20)
  let pending:PendingFollowup|null=null
  let latestKind:string|null=null
  for(const row of data||[]){
    let item:PendingFollowup
    try{item=JSON.parse(String((row as {content?:unknown})?.content||''))}catch{continue}
    if(item?.type!=='followup_state')continue
    if(latestKind===null)latestKind=String(item.kind||'')
    if(!pending&&item.kind===FOLLOWUP_KIND)pending=item
  }
  return {pending,latestKind}
}

// Fail closed: a pending objective without a valid timestamp is treated as expired,
// so it can never be resurrected by a stray email days later.
function pendingIsFresh(pending:PendingFollowup){
  const raw=pending?.created_at||(pending?.payload?.created_at as string|undefined)
  const createdAt=raw?new Date(raw).getTime():NaN
  if(!Number.isFinite(createdAt))return false
  return Date.now()-createdAt<=FOLLOWUP_MAX_MINUTES*60*1000
}

// A bare email/URL binds only when nothing has happened since this flow asked for it:
// the newest saved turns must be the prompting request and this flow's own question.
// Any other turn in between that the surface persisted breaks the binding, so a stray
// email cannot be consumed by an older objective. Limitation: a WhatsApp handler that
// saves neither the user turn nor its reply is invisible here; the 30-minute expiry and
// newest-question check still apply. Rows from one insert can share a timestamp, so the
// pair is matched in either order. Older pending states without a stored prompt never
// bind and are simply asked again.
async function pendingStillBound(telegramId:number,originText:string,promptText:string,currentText:string){
  if(!norm(originText)||!norm(promptText))return false
  const {data}=await supabaseAdmin.from('conversations')
    .select('role, content')
    .eq('telegram_id',telegramId)
    .order('created_at',{ascending:false})
    .limit(4)
  const rows=(data||[]).map((row:{role?:unknown;content?:unknown})=>({role:String(row?.role||''),content:norm(row?.content)}))
  // The current message may already be persisted by the surface; skip it.
  if(rows[0]&&rows[0].role==='user'&&rows[0].content===norm(currentText))rows.shift()
  const head=rows.slice(0,2)
  const prompt=norm(promptText)
  return head.some(row=>row.role==='assistant'&&row.content.includes(prompt))
    &&head.some(row=>row.role==='user'&&row.content===norm(originText))
}

function isHomepageUrl(value:string){
  try{const url=new URL(value);return url.protocol==='https:'&&(url.pathname===''||url.pathname==='/')&&!url.search}catch{return false}
}

function looksLikeSignupUrl(value:string){
  try{
    const url=new URL(value)
    return /\b(?:join|sign-?up|signup|register|registration|create[-_/]?(?:account|user)|new[-_/]?(?:account|user))\b/i.test(url.pathname)
  }catch{return false}
}

// ---- Look-alike domain detection -------------------------------------------------
// The sandbox network allowlist already confines a run to the target host, and Vault
// credentials are matched to the current page host. What remains is the target itself:
// a user-supplied link that imitates a known provider (hugginface.co, hugging-face.co,
// huggingface.co.example.net) must never receive the user's details.
const MULTI_PART_SUFFIX=new Set(['co.in','org.in','net.in','gov.in','ac.in','edu.in','co.uk','org.uk','ac.uk','com.au','net.au','co.jp','co.nz','com.sg','com.br'])
function registrableDomain(host:string){
  const labels=host.split('.').filter(Boolean)
  if(labels.length<=2)return labels.join('.')
  const lastTwo=labels.slice(-2).join('.')
  return MULTI_PART_SUFFIX.has(lastTwo)?labels.slice(-3).join('.'):lastTwo
}
function deconfuse(value:string){
  return String(value||'').toLowerCase().replace(/rn/g,'m').replace(/vv/g,'w').replace(/0/g,'o').replace(/[1|]/g,'l').replace(/5/g,'s').replace(/[^a-z0-9]/g,'')
}
function editDistance(a:string,b:string){
  const d:number[][]=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i===0?j:j===0?i:0))
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
    const cost=a[i-1]===b[j-1]?0:1
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost)
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+cost)
  }
  return d[a.length][b.length]
}

/** Returns the known provider a host imitates, or null if it is genuine or unrelated. */
export function lookalikeProviderForHost(hostname:string):VaultProvider|null{
  const host=String(hostname||'').toLowerCase().replace(/^www\./,'')
  if(!host||findVaultProviderForDomain(host))return null
  const reg=registrableDomain(host)
  const regLabel=reg.split('.')[0]||''
  const subLabels=host.slice(0,Math.max(0,host.length-reg.length)).split('.').filter(Boolean)
  for(const provider of Object.values(VAULT_PROVIDERS)){
    for(const domain of provider.domains){
      const brand=registrableDomain(domain).split('.')[0]||''
      if(brand.length<4)continue
      const b=deconfuse(brand),r=deconfuse(regLabel)
      // Brand used as a subdomain of someone else's site: huggingface.co.example.net
      if(subLabels.some(label=>deconfuse(label)===b))return provider
      // Homoglyph or hyphen variant: hugging-face.co, instagrarn.com
      if(r===b&&regLabel!==brand)return provider
      // Typosquat: hugginface.co. Short brands tolerate one edit, longer ones two.
      if(r!==b&&Math.min(r.length,b.length)>=5&&editDistance(r,b)<=(b.length>=8?2:1))return provider
      // Brand padded with words: huggingface-login.com
      if(r!==b&&regLabel.includes('-')&&r.includes(b))return provider
    }
  }
  return null
}

type TargetResolution=
  |{kind:'trusted';provider:VaultProvider|null;url:string}
  |{kind:'lookalike';provider:VaultProvider;host:string}
  |{kind:'mismatch';provider:VaultProvider;host:string}
  |{kind:'unverifiable';host:string}
  |{kind:'need_url'}

// Internationalised hosts reach us as punycode (xn--). Confusable letters such as a Cyrillic
// "а" in "huggingfаce.co" produce a host that no ASCII look-alike rule can see, so we fail
// closed rather than guess. Genuine non-English brands can use the ASCII link instead.
function isPunycodeHost(host:string){return /(?:^|\.)xn--/i.test(host)}

function resolveTarget(request:ExternalAccountRequest):TargetResolution{
  const byText=findVaultProviderInText(request.service)
  const host=request.url?new URL(request.url).hostname.replace(/^www\./,''):''
  if(host&&isPunycodeHost(host))return {kind:'unverifiable',host}
  if(byText){
    if(request.url){
      const byDomain=findVaultProviderForDomain(host)
      if(!byDomain||byDomain.key!==byText.key)return {kind:'mismatch',provider:byText,host}
    }
    if(byText.signupUrl)return {kind:'trusted',provider:byText,url:byText.signupUrl}
    if(request.url&&looksLikeSignupUrl(request.url))return {kind:'trusted',provider:byText,url:request.url}
    return {kind:'need_url'}
  }
  if(!request.url)return {kind:'need_url'}
  const byDomain=findVaultProviderForDomain(host)
  if(byDomain)return {kind:'trusted',provider:byDomain,url:byDomain.signupUrl||request.url}
  const imitated=lookalikeProviderForHost(host)
  if(imitated)return {kind:'lookalike',provider:imitated,host}
  // Unknown providers are allowed only when the USER supplied the exact https URL.
  // We never auto-discover a consequential target from search/name similarity.
  // The user's own link to the site's homepage is also accepted: the run stays on that host and
  // opens the site's own sign-up link from there, as a person would.
  return looksLikeSignupUrl(request.url)||isHomepageUrl(request.url)?{kind:'trusted',provider:null,url:request.url}:{kind:'need_url'}
}

/** Human-readable service name: the registry label when known, else what the user said. */
function displayService(request:ExternalAccountRequest){
  const known=findVaultProviderInText(request.service)
    ||(request.url?findVaultProviderForDomain(new URL(request.url).hostname):null)
  return known?.label||request.service
}

async function prepareExternalAccount(params:{actor:AgentActor;surface:AgentSurface;request:ExternalAccountRequest;originText:string}){
  const service=displayService(params.request)
  const email=params.request.email
  if(!email){
    const text=`Which email should I use for the ${service} account?`
    await saveFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND,{
      service:params.request.service,url:params.request.url,stage:'email',originText:params.originText,promptText:text,
    })
    return {text,status:'paused',handledBy:'external-account-objective'}
  }

  const target=resolveTarget(params.request)
  if(target.kind!=='trusted'){
    const official=target.kind==='lookalike'||target.kind==='mismatch'?target.provider.domains[0]:''
    const text=target.kind==='lookalike'
      ?`That link (${target.host}) imitates ${target.provider.label} but is not its official site (${official}), so I will not enter your details there. Send the official ${target.provider.label} signup link if that is what you meant.`
      :target.kind==='mismatch'
        ?`That link (${target.host}) is not on ${target.provider.label}'s official site (${official}), so I will not use it. Send the official ${target.provider.label} signup link to continue.`
        :target.kind==='unverifiable'
          ?`That link (${target.host}) uses characters I cannot verify safely, so I will not enter your details there. Send the site's plain ASCII signup link instead.`
          :`I have the account objective and email. Send me the official ${service} signup-page URL so I can continue safely.`
    await saveFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND,{
      service:params.request.service,email,stage:'url',originText:params.originText,promptText:text,
    })
    return {text,status:'paused',handledBy:'external-account-objective'}
  }

  const url=target.url
  const host=new URL(url).hostname.replace(/^www\./,'')
  // Like a person filling the form: ask for the username and name now, so Gogo enters every
  // field itself and never invents one. The password is generated and saved to the Vault.
  const username=norm(params.request.username)
  const fullName=norm(params.request.fullName)
  if(!username){
    const suggestion=String(email.split('@')[0]||'yourname').toLowerCase().replace(/[^a-z0-9._-]+/g,'-').slice(0,30)||'yourname'
    const text=`For the ${service} account I also need a username and your full name. Reply like: username ${suggestion}, name Your Full Name. Gogo will create a strong password and save it in your Vault.`
    await saveFollowupState(params.actor.legacyTelegramId,FOLLOWUP_KIND,{
      service:params.request.service,email,url:params.request.url,stage:'profile',originText:params.originText,promptText:text,
    })
    return {text,status:'paused',handledBy:'external-account-objective'}
  }
  const command:BrowserCommand={
    url,
    mode:'execute',
    risk:'high',
    approvalAction:'submit_form',
    flow:'account_creation',
    objective:[
      `Create an account on ${service} (${host}) using email ${email}, username ${username}${fullName?` and full name ${fullName}`:''}.`,
      'Enter exactly these values. If the site rejects the username (for example it is taken), stop and report it; never pick another one.',
      ...(looksLikeSignupUrl(url)?[]:['This is the site\'s homepage: first click its own Sign up / Create account link on this same site, then fill the sign-up pages.']),
      'For new-password fields use fill_secret; Gogo generates the password and saves it in the Vault after the account is created.',
      'Do not spend money, start a paid subscription, or bypass any CAPTCHA, OTP, passkey, email-verification, or other human-auth step.',
      'If credentials are required, use the owner-bound Vault path; never expose secrets in chat.',
      'Pause for Take Control at human-only verification boundaries and resume this same run afterward.',
      'Only claim success after the provider visibly confirms the account was created.',
    ].join(' '),
  }
  const result=await runBrowserCommand({actor:params.actor,surface:params.surface,command})
  if(result?.status==='waiting_approval'){
    // Nothing is opened before this approval (runBrowserCommand returns waiting_approval
    // ahead of the browser). For a provider we do not have in the registry, the user must
    // also check the address itself, because we have not verified the site's identity.
    const verifyNote=target.provider
      ?''
      :`${host} is not a provider I have verified, so check the address carefully. `
    const details=[`email ${email}`,`username ${username}`,...(fullName?[`name ${fullName}`]:[])].join(', ')
    return {...result,text:`Ready to create the ${service} account on ${host} with ${details}. Gogo will create a strong password and save it in your Vault. ${verifyNote}Creating it may accept the site's terms/code of conduct and submit your details. Reply *APPROVE* to continue or *REJECT* to stop.`,handledBy:'external-account-objective'}
  }
  return result?{...result,handledBy:'external-account-objective'}:null
}

// A genuine account objective that fails must stay claimed by this flow and report an
// honest state. Falling through would let a generic planner answer it, and a raw error
// would surface as a generic failure with no explanation.
async function prepareSafely(params:{actor:AgentActor;surface:AgentSurface;request:ExternalAccountRequest;originText:string}){
  try{
    return await prepareExternalAccount(params)
  }catch(error){
    console.error('EXTERNAL_ACCOUNT_FLOW_FAILED:',errorText(error))
    return {
      text:`I could not start the ${displayService(params.request)} account setup just now. Nothing was submitted. Please try again in a moment.`,
      status:'blocked',
      handledBy:'external-account-objective',
    }
  }
}

export async function tryRunExternalAccountFlow(params:{actor:AgentActor;surface:AgentSurface;text:string;messageId?:string|number|null}){
  const telegramId=params.actor.legacyTelegramId
  const candidate=isExternalAccountCandidate(params.text)

  let pendingState:{pending:PendingFollowup|null;latestKind:string|null}={pending:null,latestKind:null}
  try{
    pendingState=await readPendingAccountFollowup(telegramId)
  }catch(error){
    // Account bookkeeping must never break an unrelated message on any surface. A fresh
    // account request can still proceed without the pending read.
    console.error('EXTERNAL_ACCOUNT_PENDING_READ_FAILED:',errorText(error))
    if(!candidate)return null
  }

  const pending=pendingState.pending
  if(pending){
    // An unrelated turn invalidates the pending question, exactly as before; but the
    // clear is best-effort and can never fail this message.
    if(!candidate){
      await clearFollowupState(telegramId,FOLLOWUP_KIND).catch(()=>{})
      return null
    }
    try{
      const payload=pending.payload||{}
      // 10 Oct live run: "Goverdhan\nGogo" answered the username/name question but was not
      // recognised, fell into general chat, and no task was created. While that question is
      // pending, an unlabelled short answer counts; the approval message shows the reading.
      const profile=parseAccountProfile(params.text)||(payload.stage==='profile'?parseLooseAccountProfile(params.text):null)
      const answersPending=emailOnly(params.text)||urlOnly(params.text)||Boolean(profile)
      if(!pendingIsFresh(pending)){
        await clearFollowupState(telegramId,FOLLOWUP_KIND)
      }else if(answersPending&&pendingState.latestKind!==FOLLOWUP_KIND){
        // Another flow asked a newer question; a bare email/URL answers that one, not us.
        await clearFollowupState(telegramId,FOLLOWUP_KIND)
        return null
      }else{
        const bound=await pendingStillBound(telegramId,String(payload.originText||''),String(payload.promptText||''),params.text)
        if(!bound){
          await clearFollowupState(telegramId,FOLLOWUP_KIND)
        }else if(payload.stage==='email'&&emailOnly(params.text)){
          await clearFollowupState(telegramId,FOLLOWUP_KIND)
          return prepareSafely({
            actor:params.actor,surface:params.surface,originText:String(params.text).trim(),
            request:{service:String(payload.service||''),email:String(params.text).trim(),url:payload.url?String(payload.url):null},
          })
        }else if(payload.stage==='profile'&&profile){
          await clearFollowupState(telegramId,FOLLOWUP_KIND)
          return prepareSafely({
            actor:params.actor,surface:params.surface,originText:String(params.text).trim(),
            request:{service:String(payload.service||''),email:String(payload.email||''),url:payload.url?String(payload.url):null,username:profile.username,fullName:profile.fullName},
          })
        }else if(payload.stage==='url'&&urlOnly(params.text)){
          await clearFollowupState(telegramId,FOLLOWUP_KIND)
          // Rebind any re-prompt (e.g. a refused look-alike link) to this URL turn, so the
          // user's corrected link binds to the question it answers.
          return prepareSafely({
            actor:params.actor,surface:params.surface,originText:String(params.text).trim(),
            request:{service:String(payload.service||''),email:String(payload.email||''),url:String(params.text).trim(),username:payload.username?String(payload.username):null,fullName:payload.fullName?String(payload.fullName):null},
          })
        }else if(!parseExternalAccountRequest(params.text)){
          await clearFollowupState(telegramId,FOLLOWUP_KIND)
        }
      }
    }catch(error){
      console.error('EXTERNAL_ACCOUNT_FOLLOWUP_FAILED:',errorText(error))
    }
  }

  // Rules first (instant); otherwise the model reads phrasings the rules do not know.
  const request=parseExternalAccountRequest(params.text)||(mayBeAccountRequest(params.text)?await readAccountRequestWithModel(params.text):null)
  if(!request){
    // "Create an account for me" with no site named is still an account objective. Claim
    // it and ask for the site, so a generic planner can never answer it or mark prose as
    // an executed account creation.
    if(mentionsExternalAccountCreation(params.text))return {text:VAGUE_PROMPT,status:'paused',handledBy:'external-account-objective'}
    return null
  }
  return prepareSafely({actor:params.actor,surface:params.surface,request,originText:params.text})
}
