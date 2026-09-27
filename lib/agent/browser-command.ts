import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rememberTypedObjects } from './typed-object-context'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import { evaluateAgentSentinel } from './sentinel'
import { runSecureBrowser, type BrowserMode } from './secure-computer'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { buildVaultAddLink } from '@/lib/vault/connect-link'
import { findVaultProviderInText } from '@/lib/vault/providers'
import { buildApprovalBinding, assertApprovalBinding } from './approval-binding'

export type BrowserCommand = {
  url:string
  objective:string
  mode:BrowserMode
  risk:'low'|'medium'|'high'
  approvalAction?:'submit_form'|'booking'|'purchase'
  vaultCredentialId?:string
}

function safe(value:unknown,max=1800){return redactSecretShapedText(String(value??'').trim().slice(0,max))}

function browserApprovalFingerprintInput(runId:string,stepId:string,command:BrowserCommand){
  const u=new URL(command.url)
  return {
    missionId:runId,
    stepId,
    capability:'browser',
    actionType:String(command.approvalAction||'submit_form'),
    target:u.origin+u.pathname,
    payload:{
      objective:safe(command.objective,1200),
      url_sha256:createHash('sha256').update(command.url).digest('hex'),
      mode:'execute',
    },
  }
}

function extractUrl(text:string){
  const m=String(text||'').match(/https?:\/\/[^\s<>)\]}]+/i)
  if(!m)return null
  try{const u=new URL(m[0]);if(!['http:','https:'].includes(u.protocol))return null;return u.toString()}catch{return null}
}

function actionTextWithoutUrls(text:string){
  return String(text||'').replace(/https?:\/\/[^\s<>)\]}]+/gi,' ').replace(/\s+/g,' ').trim().toLowerCase()
}

function explicitlyNegates(text:string, actionPattern:string){
  const prefix=`(?:do\\s+not|don't|dont|never|without)`
  return new RegExp(`${prefix}\\s+(?:\\w+[\\s,]+){0,4}(?:${actionPattern})\\b`,'i').test(text)
}

export function parseBrowserCommand(text:string):BrowserCommand|null{
  const raw=String(text||'').trim();const url=extractUrl(raw);if(!url)return null
  const t=actionTextWithoutUrls(raw)
  const signal=/\b(open|browse|browser|website|site|page|form|fill|apply|submit|book|checkout|buy|purchase|reserve|navigate|go to|visit|inspect|check)\b/.test(t)
  if(!signal)return null

  const noPurchase=explicitlyNegates(t,'buy|purchase|checkout|pay|payment')
  const noBooking=explicitlyNegates(t,'book|booking|reserve|reservation|confirm')
  const noSubmit=explicitlyNegates(t,'submit|send|apply|confirm|create')
  const purchase=!noPurchase && /\b(buy|purchase|checkout|pay|payment)\b/.test(t)
  const booking=!noBooking && /\b(book|booking|reserve|reservation)\b/.test(t)
  const submit=!noSubmit && /\b(submit|send application|apply for|complete and send|confirm form)\b/.test(t)
  const fill=/\b(fill|complete form|prepare form|type into|enter my|draft application)\b/.test(t)
  const mode:BrowserMode=(purchase||booking||submit)?'execute':fill?'draft':'read'
  return {
    url,
    objective:safe(raw,1800),
    mode,
    risk:mode==='execute'?'high':mode==='draft'?'medium':'low',
    approvalAction:purchase?'purchase':booking?'booking':submit?'submit_form':undefined,
  }
}

export function parseConnectedProviderReadCommand(text:string):BrowserCommand|null{
  const raw=String(text||'').trim()
  if(!raw)return null
  // Public shopping sites need browser routing even without a Vault integration.
  // Keep these entry points separate from password-provider configuration.
  const shoppingSites=[
    {alias:/\bblinkit\b/i,loginUrl:'https://blinkit.com/'},
    {alias:/\b(?:swiggy\s+)?instamart\b/i,loginUrl:'https://www.swiggy.com/instamart'},
    {alias:/\bzepto\b/i,loginUrl:'https://www.zepto.com/'},
  ].filter(site=>site.alias.test(raw))
  const vaultProvider=findVaultProviderInText(raw)
  const candidates=[...shoppingSites,...(vaultProvider?[{
    alias:new RegExp('\\b(?:'+(vaultProvider.aliases||[vaultProvider.key]).map(name=>name.replace(/\./g,'\\.')).join('|')+')\\b','i'),
    loginUrl:vaultProvider.loginUrl,
  }]:[])]
  let provider=candidates[0]
  // Provider names inside search content are not extra navigation targets.
  // Still reject actual multi-provider work instead of silently dropping a site.
  const targetText=raw.match(/^(?:please\s+)?(?:open|browse|visit|navigate\s+to|go\s+to)\s+(.+?)(?=\s+and\b|[!?;,]|$)/i)?.[1]||''
  if(candidates.length>1||targetText){
    const targets=candidates.filter(candidate=>candidate.alias.test(targetText))
    if(targets.length!==1)return null
    const others=candidates.filter(candidate=>candidate!==targets[0])
    if(!others.every(candidate=>[...raw.matchAll(new RegExp(candidate.alias.source,'gi'))].every(match=>
      /\b(?:from|about|by|mentioning)\s+$/i.test(raw.slice(0,match.index)))))return null
    provider=targets[0]
  }
  if(!provider)return null

  const lower=raw.toLowerCase()
  // Remove only explicitly prohibited action verbs and coordinated verb lists.
  // Do not discard the rest of a sentence: a later affirmative action must still
  // reject read routing ("do not like posts, but follow this account").
  const mutationVerbs=['like','comment','follow','unfollow','publish','send','reply','delete','edit','change','buy','purchase','checkout','pay','book','reserve','submit','reorder','cancel','confirm','place','make','create','add','remove','empty','clear','update','increase','decrease','put','move','save','apply','redeem']
  const compoundOrder='(?:place|make|create|complete|confirm|cancel)\\s+(?:a|an|the|my|this|that|our|your)\\s+(?:order|purchase|booking|reservation|payment)'
  const prohibitedVerb=`(?:${compoundOrder}|${[...mutationVerbs,'message','post','order','set','default','use'].join('|')})`
  const negatedActions=new RegExp(`\\b(?:do\\s+not|don['\\u2019]?t|never)\\s+${prohibitedVerb}\\b(?:(?![.!?;\\n]|\\b(?:but|then|however|instead|except)\\b)[\\s\\S])*`,'gi')
  const actionable=lower.replace(negatedActions,' ')
    .replace(/\bpurchase\s+(history|details|receipt|status)\b/g,'order $1')
    .replace(/\b(my|the|your|our|this|that)\s+place\b/g,'$1 location')
    .replace(/\bupdate\s+me\s+(?:on|about)\b/g,'show me')
    .replace(/(^|[.!?;])([ \t]*(?:did|has|have|does|will)\s+(?:amazon|flipkart|blinkit|zepto|instamart|they)\s+)(?:cancel|confirm|update)(?=\s+(?:my|the|this|that|our|your)\s+(?:latest\s+|last\s+)?order\b)/g,'$1$2')
  const tokens=new Set((actionable.match(/[a-z0-9.]+/g)||[]).map(value=>value.replace(/\.$/,'')))
  const has=(...values:string[])=>values.some(value=>tokens.has(value))

  // Deterministic mutations always keep their native handlers.
  const reminderMutation=
    lower.includes('save this as a reminder') ||
    lower.includes('save as a reminder') ||
    lower.includes('create reminder') ||
    lower.includes('create a reminder') ||
    has('reminder') ||
    /^remind\b/.test(lower) ||
    /\bremind me\b/.test(lower)

  const calendarOrListMutation=
    lower.includes('create calendar event') ||
    lower.includes('create an event') ||
    lower.includes('create a list') ||
    lower.includes('schedule this') ||
    lower.includes('schedule it') ||
    (/\badd\b/.test(lower) && /\bto\s+(?:my\s+)?(?:calendar|list)\b/.test(lower))

  if(reminderMutation||calendarOrListMutation)return null
  if(/\b(?:set|default)\b[^.!?]*\b(?:address|profile|delivery|payment|cart|basket)\b/.test(actionable))return null
  if(/\buse\s+(?:(?:my|the|this|a|an)\s+)?(?:coupon|promo|voucher|code)\b/.test(actionable))return null
  if(/\b(?:add|remove|empty|clear|update|increase|decrease)\b[^.!?]*\b(?:cart|basket)\b/.test(actionable))return null

  // Consequential provider actions must never be downgraded to read mode.
  const writeTokens=mutationVerbs
  if(writeTokens.some(value=>tokens.has(value)))return null
  if(/\bcomplete\b[^.!?]*\b(?:order|purchase|checkout|payment)\b/.test(actionable))return null
  // Classify ambiguous order/message nouns within their own clause. A read in
  // one clause never licenses a purchase or message in a later clause.
  const clauses=actionable.split(/([.!?;,\n]|\b(?:and|then|but)\b)/)
  let previousRead=false
  for(const clause of clauses){
    if(!clause.trim())continue
    if(/^(?:[.!?;,\n]|and|then|but)$/.test(clause)){
      if(clause!==','&&clause!=='and')previousRead=false
      continue
    }
    if(!/\b(?:order|message)\b/.test(clause)){previousRead=/\b(?:read|check|show|find|see|view|track)\b/.test(clause);continue}
    // Validate each ambiguous occurrence, not just the first read object.
    for(const nounPart of clause.match(/[\s\S]*?\b(?:order|message)\b/g)||[]){
      const question=/^\s*(?:where|when|what|how|has|have|did|is|are|will|does)\b/.test(nounPart)
        && /\b(?:my|the|this|that|our|your)\b[^.!?;,]*\b(?:order|message)\b/.test(nounPart)
      const readObject=/\b(?:read|check|show|find|see|view|track|look\s+at|status\s+of|details\s+of|open(?=\s+(?:my|the|a|an|this|that|our|your)\b))\b[^.!?;,]*\b(?:order|message)\b/.test(nounPart)
      const coordinatedNoun=previousRead&&/^\s*(?:(?:my|the|a|an|this|that|our|your|last|latest|recent|current|previous|first|next|amazon|flipkart|instagram|facebook|linkedin|blinkit|zepto|instamart)\s+)+(?:order|message)\s*$/.test(nounPart)
      if(!question&&!readObject&&!coordinatedNoun)return null
      previousRead=true
    }
  }
  if(tokens.has('post') && /\bpost\s+(?:this|that|it|a|an|the|to)\b/.test(actionable))return null

  const readTokens=['find','search','show','look','check','open','read','see','saved','reel','reels','post','posts','order','orders','wishlist','message','messages','inbox','booking','bookings','history','receipt','receipts','invoice','invoices']
  const shoppingRead=shoppingSites.length===1&&/\b(?:price|prices|available|availability|in\s+stock|stock\s+status)\b/.test(actionable)
  if(!readTokens.some(value=>tokens.has(value))&&!shoppingRead)return null

  return {
    url:provider.loginUrl,
    // In this explicit address question PIN means postal code, not a credential.
    // Normalize the label before redaction; never exempt credential labels globally.
    objective:safe(raw.replace(/\b(ask\s+(?:me\s+)?for\s+(?:my\s+)?area\s+and\s+)pin\s+code(?=\s+if\s+(?:needed|required)\b)/gi,'$1postal code'),1800),
    mode:'read',
    risk:'low',
  }
}
export function isExplicitProviderBrowserRead(text:string){
  const target=String(text||'').trim().match(/^(?:please\s+)?(?:open|browse|visit|navigate\s+to|go\s+to)\s+(.+)$/i)?.[1]?.toLowerCase()
  if(!target)return false
  const vaultProvider=findVaultProviderInText(target)
  const aliases=[...(vaultProvider?.aliases||[]),'blinkit','instamart','swiggy instamart','zepto']
  const directTarget=aliases.some(alias=>target.startsWith(alias)&&!/[a-z0-9]/i.test(target.charAt(alias.length)))
  return directTarget&&!!parseConnectedProviderReadCommand(text)
}

async function permission(tg:number):Promise<AgentPermissionLevel>{
  const {data,error}=await supabaseAdmin.from('agent_permissions').select('level').eq('telegram_id',String(tg)).eq('capability','browser').maybeSingle()
  if(error)throw new Error(`browser_permission_failed:${error.message}`)
  return (data?.level as AgentPermissionLevel|undefined)||'ask'
}

async function activity(tg:number,runId:string,event:string,message:string,metadata:Record<string,unknown>={}){
  const {error}=await supabaseAdmin.from('agent_activity').insert({telegram_id:String(tg),run_id:runId,event_type:event,message:safe(message,900),metadata_json:metadata})
  if(error)console.error('BROWSER_AGENT_ACTIVITY_FAILED:',error.message)
}

async function makeRun(params:{actor:AgentActor;surface:AgentSurface;command:BrowserCommand}){
  const now=new Date().toISOString();const host=new URL(params.command.url).hostname
  const {data,error}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(params.actor.legacyTelegramId),type:'secure_browser',capability:'browser',status:'queued',
    title:`Browser · ${host}`,summary:'Gogo is preparing an isolated browser session.',progress:0,
    why:'This work is isolated from the AskGogo server in a per-user secure computer.',source:params.surface,
    metadata_json:{plan_type:'secure_browser',url:params.command.url,objective:params.command.objective,mode:params.command.mode,risk:params.command.risk,approval_action:params.command.approvalAction||null,vault_credential_id:params.command.vaultCredentialId||null},
    started_at:now,updated_at:now,
  }).select('id').single()
  if(error||!data?.id)throw new Error(`browser_run_create_failed:${error?.message||'unknown'}`)
  const runId=String(data.id)
  const {data:step,error:stepError}=await supabaseAdmin.from('agent_steps').insert({
    telegram_id:String(params.actor.legacyTelegramId),run_id:runId,ordinal:1,tool_name:'secure_browser',
    title:params.command.mode==='read'?'Read website in secure browser':params.command.mode==='draft'?'Prepare browser flow without submitting':'Complete approved browser action',
    status:'queued',input_json:{url:params.command.url,mode:params.command.mode},output_json:{},
  }).select('id').single()
  if(stepError||!step?.id)throw new Error(`browser_step_create_failed:${stepError?.message||'unknown'}`)
  await activity(params.actor.legacyTelegramId,runId,'run_created',`Secure browser request created for ${host}.`,{mode:params.command.mode,host})
  return {runId,stepId:String(step.id)}
}

async function approval(params:{actor:AgentActor;runId:string;stepId:string;command:BrowserCommand}){
  if(!params.command.approvalAction)return null
  const host=new URL(params.command.url).hostname
  const binding=buildApprovalBinding(browserApprovalFingerprintInput(params.runId,params.stepId,params.command))
  const {data,error}=await supabaseAdmin.from('agent_approvals').insert({
    telegram_id:String(params.actor.legacyTelegramId),run_id:params.runId,action_type:params.command.approvalAction,
    title:`Approve browser action on ${host}`,
    description:'Gogo can prepare and inspect the website safely, but this action may submit information, make a booking, or spend money.',
    payload_preview:[{label:'Website',value:host},{label:'Action',value:safe(params.command.objective,500)},{label:'Risk',value:'high'}],
    execution_payload:{plan_type:'secure_browser',stepId:params.stepId,url:params.command.url},risk_level:'high',status:'pending',...binding,
  }).select('id').single()
  if(error||!data?.id)throw new Error(`browser_approval_failed:${error?.message||'unknown'}`)
  await supabaseAdmin.from('agent_steps').update({status:'waiting_approval'}).eq('id',params.stepId)
  await supabaseAdmin.from('agent_runs').update({status:'waiting_approval',summary:'Waiting for approval before Gogo submits anything.',progress:25,updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(params.actor.legacyTelegramId))
  await activity(params.actor.legacyTelegramId,params.runId,'approval_requested',`Approval required for browser action on ${host}.`,{approval_id:data.id})
  return String(data.id)
}

async function executeBrowser(params:{actor:AgentActor;runId:string;stepId:string;command:BrowserCommand;mode:BrowserMode;approved?:boolean}){
  const tg=params.actor.legacyTelegramId
  const sentinel=evaluateAgentSentinel({
    capability:'browser',mode:params.mode,risk:params.command.risk,irreversible:params.mode==='execute',
    approved:params.approved===true,instruction:params.command.objective,url:params.command.url,actionCount:12,
  })
  if(!sentinel.allowed)throw new Error(`sentinel_${sentinel.reason}`)

  const {data:currentRun,error:currentRunError}=await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id',params.runId).eq('telegram_id',String(tg)).maybeSingle()
  if(currentRunError||!currentRun)throw new Error('browser_handoff_run_unavailable')
  const runMetadata:any=currentRun.metadata_json||{}
  const reconciledResult=runMetadata.browser_safe_to_retry===false
    ? await (await import('./post-auth-outcome')).inspectPostAuthRun(String(tg),params.runId,runMetadata):undefined
  if(reconciledResult===null)return {runId:params.runId,status:'outcome_unknown' as const,capability:'browser' as const,risk:params.command.risk,text:'The browser session is unavailable. Verify the outcome directly with the provider; Gogo will not repeat the action.',handledBy:'secure-browser' as const}
  if(reconciledResult?.status==='blocked')return {runId:params.runId,status:'paused' as const,capability:'browser' as const,risk:params.command.risk,text:reconciledResult.summary,handledBy:'secure-browser' as const}
  if(runMetadata.handoff?.releaseUrl){
    // Release the human browser's profile lock only after permission/approval checks.
    const {releaseBrowserHandoff}=await import('./browser-handoff')
    await releaseBrowserHandoff(String(runMetadata.handoff.releaseUrl),{allowExpired:true})
    delete runMetadata.handoff
    const {error}=await supabaseAdmin.from('agent_runs').update({metadata_json:runMetadata}).eq('id',params.runId).eq('telegram_id',String(tg))
    if(error)throw new Error('browser_handoff_release_save_failed')
  }

  await supabaseAdmin.from('agent_runs').update({status:'running',summary:'Gogo is working in an isolated secure browser.',progress:45,updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(tg))
  await supabaseAdmin.from('agent_steps').update({status:'running',error:null,completed_at:null,started_at:new Date().toISOString()}).eq('id',params.stepId)
  await activity(tg,params.runId,'run_started','Gogo started the isolated browser session.',{mode:params.mode})
  let pendingHandoffReservation:string|undefined
  try{
    const result=reconciledResult||await runSecureBrowser({reserveHumanHandoff:true,userId:params.actor.userId,url:params.command.url,objective:params.command.objective,mode:params.mode,vaultCredentialId:params.command.vaultCredentialId||null})
    pendingHandoffReservation=result.handoffReservation
    const at=new Date().toISOString()

    if(result.status==='blocked'){
      runMetadata.browser_safe_to_retry=!result.actions.some(action=>(action.kind==='submit'||action.consequential===true)&&action.status!=='skipped')
      runMetadata.auth_action_log=result.actions
      runMetadata.auth_original_url=params.command.url
      const blockReason=result.blockReason||'provider_access_limited'
      const compact={url:result.url,title:result.title,summary:result.summary,blockReason,authReason:result.authReason||null,credentialSelectionRequired:result.credentialSelectionRequired===true}
      await supabaseAdmin.from('agent_steps').update({status:'failed',output_json:compact,error:blockReason,completed_at:at}).eq('id',params.stepId)
      await supabaseAdmin.from('agent_runs').update({status:'paused',summary:result.summary,progress:50,error:blockReason,metadata_json:runMetadata,completed_at:at,updated_at:at}).eq('id',params.runId).eq('telegram_id',String(tg))
      await activity(tg,params.runId,blockReason,blockReason==='human_auth_required'?'Gogo paused at a human authentication boundary.':'Gogo paused because the provider limited automated access.',{host:new URL(result.url).hostname,auth_reason:result.authReason||null})
      if(blockReason==='human_auth_required'){
        if(result.authReason&&result.authReason!=='password'){
          const {startProviderBrowserHandoff,cancelProviderBrowserHandoff}=await import('./provider-browser-handoff')
          const handoff=await startProviderBrowserHandoff({userId:params.actor.userId,url:result.url,originalUrl:params.command.url,reservationToken:result.handoffReservation})
          const {error}=await supabaseAdmin.from('agent_runs').update({metadata_json:{...runMetadata,handoff},completed_at:null}).eq('id',params.runId).eq('telegram_id',String(tg))
          if(error){
            await cancelProviderBrowserHandoff(params.actor.userId,handoff).catch(()=>{})
            throw new Error('browser_handoff_save_failed')
          }
          const appBase=String(process.env.NEXT_PUBLIC_APP_URL||process.env.APP_URL||'https://app.askgogo.in').replace(/\/$/,'')
          const resumeUrl=`${appBase}/dashboard/activity/${encodeURIComponent(params.runId)}/browser`
          return {
            runId:params.runId,status:'paused' as const,capability:'browser' as const,risk:params.command.risk,
            text:`${result.summary}\n\nOpen this task to Take control, complete the human-only step, then select Resume this task:\n${resumeUrl}\n\nDo not paste passwords or one-time codes into chat. Gogo keeps this same task and rechecks permissions before continuing.`,
            blockedReason:'human_auth_required' as const,handledBy:'secure-browser' as const,
          }
        }
        const host=new URL(result.url).hostname
        const vault=await buildVaultAddLink({
          telegramId:tg,
          domain:host,
          runId:params.runId,
        }).catch(()=>null)
        const appBase=String(process.env.NEXT_PUBLIC_APP_URL||process.env.APP_URL||'https://app.askgogo.in').replace(/\/$/,'')
        const accountChoiceUrl=`${appBase}/dashboard/activity/${encodeURIComponent(params.runId)}/browser`
        const loginHelp=result.credentialSelectionRequired
          ? `\n\nI found more than one saved login for this provider. Choose the account Gogo should use here:\n${accountChoiceUrl}`
          : vault
            ? `\n\nDon't send your password here. Save or update the ${vault.provider.label} login securely:\n${vault.url}\n\nAfter you save it, Gogo will automatically retry this same task.`
            : '\n\nUse Take Control to complete the provider sign-in securely. Do not paste passwords or one-time codes into chat.'
        return {
          runId:params.runId,status:'paused' as const,capability:'browser' as const,risk:params.command.risk,
          text:`${result.summary}\n\nGogo paused before authentication. Passwords, OTPs, passkeys and payment-auth values are not requested, inferred or stored by the agent.${loginHelp}`,
          blockedReason:'human_auth_required' as const,handledBy:'secure-browser' as const,
        }
      }
      return {
        runId:params.runId,status:'paused' as const,capability:'browser' as const,risk:params.command.risk,
        text:`${result.summary}\n\nThe provider page did not expose verifiable live availability to the secure browser. No provider-side action was made.`,
        blockedReason:'provider_access_limited' as const,handledBy:'secure-browser' as const,
      }
    }

    const compact={url:result.url,title:result.title,summary:result.summary,formCount:result.forms.length,actions:result.actions}
    await supabaseAdmin.from('agent_steps').update({status:'completed',output_json:compact,error:null,completed_at:at}).eq('id',params.stepId)
    await supabaseAdmin.from('agent_runs').update({status:'completed',summary:safe(`${result.summary} ${result.title}`,1600),progress:100,completed_at:at,error:null,updated_at:at}).eq('id',params.runId).eq('telegram_id',String(tg))
    await activity(tg,params.runId,'run_completed',result.summary,{host:new URL(result.url).hostname,action_count:result.actions.length})
    return {runId:params.runId,status:'completed' as const,capability:'browser' as const,risk:params.command.risk,text:`${result.summary}\n\n${result.title}\n${safe(result.pageText,1800)}`,handledBy:'secure-browser' as const}
  }catch(err:any){
    if(pendingHandoffReservation)await (await import('./provider-browser-handoff')).cancelBrowserHandoffReservation(params.actor.userId,pendingHandoffReservation).catch(()=>{})
    if(runMetadata.browser_safe_to_retry===false){
      const outcome=await (await import('./post-auth-outcome')).markAuthOutcomeUnknown(String(tg),params.runId,runMetadata)
      return {...outcome,capability:'browser' as const,risk:params.command.risk,handledBy:'secure-browser' as const}
    }
    const message=String(err?.message||'secure_browser_failed');const at=new Date().toISOString()
    await Promise.resolve(supabaseAdmin.from('agent_steps').update({status:'failed',error:safe(message,500),completed_at:at}).eq('id',params.stepId)).catch(()=>{})
    await Promise.resolve(supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not complete the secure browser session.',error:safe(message,500),completed_at:at,updated_at:at}).eq('id',params.runId).eq('telegram_id',String(tg))).catch(()=>{})
    await activity(tg,params.runId,'run_failed','Secure browser session failed.',{error:safe(message,250)})
    throw err
  }
}

export async function tryRunBrowserCommand(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const command=parseBrowserCommand(params.text)||parseConnectedProviderReadCommand(params.text);if(!command)return null
  const sentinel=evaluateAgentSentinel({capability:'browser',mode:command.mode,risk:command.risk,irreversible:command.mode==='execute',approved:false,instruction:command.objective,url:command.url,actionCount:12})
  if(!sentinel.allowed && sentinel.reason!=='approval_missing'){
    return {runId:'',status:'paused' as const,capability:'browser' as const,risk:command.risk,text:`Gogo Sentinel blocked this browser request: ${sentinel.reason}`,handledBy:'secure-browser' as const}
  }

  const tg=params.actor.legacyTelegramId;const {runId,stepId}=await makeRun({actor:params.actor,surface:params.surface,command})
  await rememberTypedObjects(tg,'browser',[{id:runId,title:'Browser task'}]).catch(()=>{})
  const level=await permission(tg)
  const policy=evaluateAgentExecutionPolicy({capability:'browser',permissionLevel:level,mode:command.mode,risk:command.risk,irreversible:command.mode==='execute',approvalStatus:null})
  if(!policy.allowed){
    if(command.mode==='execute' && command.approvalAction && (policy.reason==='approval_required'||policy.reason==='auto_not_allowed_for_consequential_action')){
      const approvalId=await approval({actor:params.actor,runId,stepId,command})
      return {runId,status:'waiting_approval' as const,capability:'browser' as const,risk:'high' as const,text:'I can do this in the secure browser, but I need your approval before the final submit/booking/purchase.',approvalId,approvalRequired:true,handledBy:'secure-browser' as const}
    }
    await supabaseAdmin.from('agent_runs').update({status:'paused',summary:`Browser blocked by Gogo Safe Mode: ${policy.reason}`,updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',String(tg))
    return {runId,status:'paused' as const,capability:'browser' as const,risk:command.risk,text:`Gogo Safe Mode blocked the browser action: ${policy.reason}`,handledBy:'secure-browser' as const}
  }
  return executeBrowser({actor:params.actor,runId,stepId,command,mode:command.mode,approved:false})
}

export async function executeApprovedBrowserCommand(params:{actor:AgentActor;runId:string}){
  const tg=params.actor.legacyTelegramId
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id',params.runId).eq('telegram_id',String(tg)).maybeSingle()
  if(error)throw new Error(`agent_run_read_failed:${error.message}`);if(!run)throw new Error('agent_run_not_found')
  const meta:any=run.metadata_json||{};if(meta.plan_type!=='secure_browser')throw new Error('not_secure_browser_run')
  const command:BrowserCommand={url:String(meta.url||''),objective:safe(meta.objective,1800),mode:'execute',risk:'high',approvalAction:meta.approval_action||'submit_form',vaultCredentialId:String(meta.vault_credential_id||'').trim()||undefined}
  const {data:approved}=await supabaseAdmin.from('agent_approvals').select('id,status,execution_payload,action_hash,policy_version').eq('run_id',params.runId).eq('telegram_id',String(tg)).eq('status','approved').order('resolved_at',{ascending:false}).limit(1).maybeSingle()
  if(!approved)throw new Error('approval_required')
  const approvedStepId=String((approved.execution_payload as any)?.stepId||'')
  if(!approvedStepId)throw new Error('approval_binding_step_missing')
  assertApprovalBinding(browserApprovalFingerprintInput(params.runId,approvedStepId,command),approved)
  const level=await permission(tg)
  const policy=evaluateAgentExecutionPolicy({capability:'browser',permissionLevel:level,mode:'execute',risk:'high',irreversible:true,approvalStatus:'approved'})
  if(!policy.allowed)throw new Error(policy.reason)
  const sentinel=evaluateAgentSentinel({capability:'browser',mode:'execute',risk:'high',irreversible:true,approved:true,instruction:command.objective,url:command.url,actionCount:12})
  if(!sentinel.allowed)throw new Error(`sentinel_${sentinel.reason}`)
  const {data:step}=await supabaseAdmin.from('agent_steps').select('id').eq('run_id',params.runId).eq('telegram_id',String(tg)).eq('tool_name','secure_browser').limit(1).maybeSingle()
  if(!step?.id)throw new Error('browser_step_missing')
  const result=await executeBrowser({actor:params.actor,runId:params.runId,stepId:String(step.id),command,mode:'execute',approved:true})
  if(result.status==='completed')await supabaseAdmin.from('agent_approvals').update({status:'executed',executed_at:new Date().toISOString()}).eq('id',approved.id).eq('telegram_id',String(tg))
  return result
}


export async function resumePausedBrowserRun(params:{actor:AgentActor;runId:string}){
  const tg=params.actor.legacyTelegramId
  const {data:run,error}=await supabaseAdmin.from('agent_runs')
    .select('id,status,type,metadata_json')
    .eq('id',String(params.runId))
    .eq('telegram_id',String(tg))
    .maybeSingle()
  if(error)throw new Error(`browser_resume_read_failed:${error.message}`)
  if(!run||run.type!=='secure_browser')throw new Error('browser_resume_run_not_found')
  if(!['paused','failed','waiting_approval'].includes(String(run.status)))throw new Error('browser_resume_not_paused')

  const meta:any=run.metadata_json||{}
  const mode=String(meta.mode||'read') as BrowserMode

  // Consequential runs must resume through the exact approval path. The
  // approval survives a password/MFA pause, so we revalidate it rather than
  // silently downgrading the run or bypassing approval.
  if(mode==='execute'){
    const {data:approved,error:approvalError}=await supabaseAdmin.from('agent_approvals')
      .select('id,status')
      .eq('run_id',String(params.runId))
      .eq('telegram_id',String(tg))
      .eq('status','approved')
      .order('resolved_at',{ascending:false})
      .limit(1)
      .maybeSingle()
    if(approvalError)throw new Error(`browser_resume_approval_failed:${approvalError.message}`)
    if(!approved)throw new Error('approval_required')
    return executeApprovedBrowserCommand({actor:params.actor,runId:String(params.runId)})
  }

  const command:BrowserCommand={
    url:String(meta.url||''),
    objective:safe(meta.objective,1800),
    mode,
    risk:mode==='draft'?'medium':'low',
    approvalAction:meta.approval_action||undefined,
    vaultCredentialId:String(meta.vault_credential_id||'').trim()||undefined,
  }
  if(!command.url)throw new Error('browser_resume_missing_url')

  // Re-evaluate the CURRENT permission and policy on every resume. A user may
  // have changed Safe Mode/browser permissions while the run was paused.
  const level=await permission(tg)
  const policy=evaluateAgentExecutionPolicy({
    capability:'browser',
    permissionLevel:level,
    mode,
    risk:command.risk,
    irreversible:false,
    approvalStatus:null,
  })
  if(!policy.allowed)throw new Error(`browser_resume_permission_blocked:${policy.reason}`)

  const sentinel=evaluateAgentSentinel({
    capability:'browser',
    mode,
    risk:command.risk,
    irreversible:false,
    approved:false,
    instruction:command.objective,
    url:command.url,
    actionCount:12,
  })
  if(!sentinel.allowed)throw new Error(`sentinel_${sentinel.reason}`)

  const {data:step,error:stepError}=await supabaseAdmin.from('agent_steps')
    .select('id')
    .eq('run_id',String(params.runId))
    .eq('telegram_id',String(tg))
    .eq('tool_name','secure_browser')
    .order('ordinal',{ascending:false})
    .limit(1)
    .maybeSingle()
  if(stepError)throw new Error(`browser_resume_step_failed:${stepError.message}`)
  if(!step?.id)throw new Error('browser_resume_step_missing')

  await activity(tg,String(params.runId),'run_resumed','Gogo resumed the browser task after secure login setup.',{source:'vault'})
  return executeBrowser({
    actor:params.actor,
    runId:String(params.runId),
    stepId:String(step.id),
    command,
    mode,
    approved:false,
  })
}

