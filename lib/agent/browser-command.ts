import { sanitizeBrowserReadDiagnostics } from './browser-read-diagnostics'
import { createHash } from 'node:crypto'
import { browserFailureSummary } from './browser-failure-notice'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rememberTypedObjects } from './typed-object-context'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import { evaluateAgentSentinel } from './sentinel'
import { runSecureBrowser, type BrowserMode } from './secure-computer'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { buildVaultAddLink } from '@/lib/vault/connect-link'
import { VAULT_PROVIDERS } from '@/lib/vault/providers'
import { buildApprovalBinding, assertApprovalBinding } from './approval-binding'
import { hasLeadingReportMutation } from '@/lib/services/reporting-directive'

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
  // 3 Oct live Amazon test: a long "Do not sign in, add to cart or buy"
  // list exceeded the negation matcher. An explicit read-only instruction
  // bounds authority even when a later prohibition contains a purchase verb.
  const readOnly=/(?:^|[.!?;])\s*read[ -]only\b/.test(t)
  const mode:BrowserMode=readOnly?'read':(purchase||booking||submit)?'execute':fill?'draft':'read'
  return {
    url,
    objective:safe(raw,1800),
    mode,
    risk:mode==='execute'?'high':mode==='draft'?'medium':'low',
    approvalAction:mode!=='execute'?undefined:purchase?'purchase':booking?'booking':submit?'submit_form':undefined,
  }
}

function providerContentSearch(text:string){
  return text.match(/^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:find|search\s+for|show(?:\s+me)?)\s+(.+?)\s+on\s+(.+)$/i)
    ||text.match(/^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:find|search\s+for|show(?:\s+me)?)\s+(.+?)\s+from\s+(.+)$/i)
}

function normalizeProviderTarget(text:string){
  return text.toLowerCase().replace(/^(?:the|a|an|my|your|our)\s+/,'').replace(/^(?:app|website|site)\s+(?:for\s+)?/,'')
}
function startsWithProviderTarget(text:string){
  const target=normalizeProviderTarget(text)
  return [...Object.values(VAULT_PROVIDERS).flatMap(provider=>provider.aliases||[provider.key]),'blinkit','instamart','swiggy instamart','zepto'].some(alias=>target.startsWith(alias)&&!/[a-z0-9]/i.test(target.charAt(alias.length)))
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
  const vaultCandidates=Object.values(VAULT_PROVIDERS).map(provider=>({
    alias:new RegExp('\\b(?:'+(provider.aliases||[provider.key]).map(name=>name.replace(/\./g,'\\.')).join('|')+')\\b','i'),
    loginUrl:provider.loginUrl,
  })).filter(provider=>provider.alias.test(raw))
  const candidates=[...shoppingSites,...vaultCandidates]
  let provider=candidates[0]
  // Provider names inside search content are not extra navigation targets.
  // Still reject actual multi-provider work instead of silently dropping a site.
  const sourceTarget=providerContentSearch(raw)?.[2]||''
  const directNavigation=raw.match(/^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:open|browse|visit|show(?:\s+me)?|search(?!\s+for\b)|navigate\s+to|go\s+to)\s+(.+)$/i)?.[1]||''
  const navigationText=startsWithProviderTarget(directNavigation)?directNavigation:sourceTarget||directNavigation
  const targetText=normalizeProviderTarget(navigationText).split(/\s+(?:and|for|to|then|about|from|by|mentioning)\b|[!?;,]/i)[0]
  if(candidates.length>1||targetText){
    const targets=candidates.filter(candidate=>candidate.alias.test(targetText))
    if(targets.length!==1)return null
    const others=candidates.filter(candidate=>candidate!==targets[0])
    if(!others.every(candidate=>[...raw.matchAll(new RegExp(candidate.alias.source,'gi'))].every(match=>
      /\b(?:from|about|by|mentioning|for)\s+(?:(?:the|a|an)\s+)?$/i.test(raw.slice(0,match.index)))))return null
    provider=targets[0]
  }
  if(!provider)return null

  const lower=raw.toLowerCase()
  if(/^(?:please\s+)?(?:show|open|read|find|check)\s+(?:me\s+)?(?:my|the)\s+[^.!?]*\b(?:lists?|notes?|memories|memory)\b/.test(lower))return null
  // Remove only explicitly prohibited action verbs and coordinated verb lists.
  // Do not discard the rest of a sentence: a later affirmative action must still
  // reject read routing ("do not like posts, but follow this account").
  const mutationVerbs=['like','comment','follow','unfollow','publish','send','reply','delete','edit','change','buy','purchase','checkout','pay','book','reserve','submit','reorder','cancel','confirm','place','make','create','add','remove','empty','clear','update','increase','decrease','put','move','save','apply','redeem','subscribe','unsubscribe','renew','share','block','unblock','reschedule','postpone','modify']
  const compoundOrder='(?:place|make|create|complete|confirm|cancel)\\s+(?:a|an|the|my|this|that|our|your)\\s+(?:order|purchase|booking|reservation|payment)'
  const prohibitedVerb=`(?:${[...mutationVerbs,'message','post','order','set','default','use','return','exchange','refund','rate','report'].join('|')})`
  const negatedActions=new RegExp(`\\b(?:do\\s+not|don['\\u2019]?t|never)\\s+(?:${compoundOrder}\\b|(?:start|begin|continue|keep)\\s+\\w+ing\\b|${prohibitedVerb}\\b(?:\\s*(?:,\\s*(?:(?:or|and)\\s+)?|(?:or|and)\\s+)${prohibitedVerb}\\b)*)(?:(?![.!?;,\\n]|\\b(?:and|but|then|however|instead|except|before|after|while|until|once|when|to)\\b)[\\s\\S])*`,'gi')
  const actionable=lower.replace(negatedActions,' ')
    .replace(/\bmake\s+sure\s+([^.!?;,]*?\b(?:available|in\s+stock)\b)/g,'check $1')
    .replace(/\bpurchase\s+(history|details|receipt|status)\b/g,'order $1')
    .replace(/\b(my|the|your|our|this|that)\s+place\b/g,'$1 location')
    .replace(/\bupdate\s+me\s+(?:on|about)\b/g,'show me')
    .replace(/\b(the|an?|my|latest|recent|current|status)\s+update\b/g,'$1 status')
    .replace(/(^|[.!?;])([ \t]*(?:did|has|does|will)\s+(?:amazon|flipkart|blinkit|zepto|instamart|they)\s+)(?:cancel|confirm|update)(?=\s+(?:my|the|this|that|our|your)\s+(?:latest\s+|last\s+)?order\b)/g,'$1$2')
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
  if(/(?:^|[.!?;,]|\b(?:and|then|to)\b)\s*(?:please\s+)?(?:return|exchange|refund|rate)(?!\s+(?:(?:the|my|this)\s+)?(?:price|results?|information|details|availability|summary|answer|control)\b)\s+/.test(actionable))return null
  // "report" as a clause-leading verb is a provider mutation (report a seller /
  // story / reel / post / message / account / listing as spam/abuse — an open-ended
  // set). The ONE benign exception is a reporting DIRECTIVE that tells Gogo how to
  // answer ("Report only verified results", "report back the findings", "report the
  // price/status"). hasLeadingReportMutation() judges each occurrence locally so a
  // benign trailing directive cannot mask a leading mutation.
  if(hasLeadingReportMutation(actionable))return null
  if(/\b(?:start|begin|continue|keep|before|after|while|until|once|when)\s+(?:ordering|buying|purchasing|booking|paying|submitting|redeeming|applying|following|unfollowing|liking|commenting|publishing|sending|replying|deleting|editing|changing|saving|blocking|unblocking|sharing|posting|messaging|returning|refunding|exchanging|canceling|cancelling|confirming|placing|making|creating|adding|removing|emptying|clearing|updating|increasing|decreasing|putting|moving|subscribing|unsubscribing|renewing|rescheduling|postponing|modifying|rating|reporting)\b/.test(actionable))return null
  if(shoppingSites.length&&/\bget\s+(?!(?:(?!\b(?:and|then|but|at|for|with|to|from|on|under|below|above|over)\b)[^.!?;,])*\b(?:prices?|costs?|availability|information|details|status)\b)/.test(actionable))return null
  if(/\b(?:request|initiate|process|claim)\b[^.!?]*\b(?:refund|return|cancellation)\b/.test(actionable))return null
  if(/(?:\bset\b|(?:^|[.!?;,]|\b(?:and|then|to)\b)\s*(?:please\s+)?default\b)[^.!?]*\b(?:address|profile|delivery|payment|cart|basket)\b/.test(actionable))return null
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
      const questionPart=nounPart.replace(/^\s*(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?tell\s+me\s+/,'')
      const question=/^\s*(?:where|when|what|why|which|whose|how|has|have|had|do|does|did|am|is|are|was|were|can|could|will|would|shall|should|may|might|must)\b/.test(questionPart)
        && /\b(?:my|the|a|an|any|this|that|our|your)\b[^.!?;,]*\b(?:order|message)\b/.test(nounPart)
      const readObject=/\b(?:read|check|show|find|see|view|track|look\s+at|status\s+of|details\s+of|open(?=\s+(?:my|the|a|an|this|that|our|your)\b))\b[^.!?;,]*\b(?:order|message)\b/.test(nounPart)
      const coordinatedNoun=previousRead&&/^\s*(?:(?:my|the|a|an|this|that|our|your|last|latest|recent|current|previous|first|next|amazon|flipkart|instagram|facebook|linkedin|blinkit|zepto|instamart)\s+)+(?:order|message)\s*$/.test(nounPart)
      if(!question&&!readObject&&!coordinatedNoun)return null
      previousRead=true
    }
  }
  if(tokens.has('post') && /\bpost\s+(?:this|that|it|a|an|the|to)\b/.test(actionable))return null

  const readTokens=['find','search','show','look','check','open','read','see','saved','reel','reels','post','posts','order','orders','wishlist','message','messages','inbox','booking','bookings','history','receipt','receipts','invoice','invoices']
  const shoppingRead=shoppingSites.length===1&&/\b(?:price|prices|cost|costs|how\s+much|available|availability|in\s+stock|stock\s+status)\b/.test(actionable) || (shoppingSites.length===1&&/\b(?:does|do)\s+(?:blinkit|zepto|(?:swiggy\s+)?instamart)\s+(?:have|carry|stock|sell)\b/.test(actionable))
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
// Explicitly-authorized "add to cart" on a shopping provider. This is a consequential
// action, so it returns an EXECUTE command with an approvalAction — it must pass through
// the approval gate before anything is added, and it must NOT place an order / pay /
// checkout (those stay human-only / rejected). Kept separate from the read parser so the
// delicate read path stays strictly read-only.
export function parseConnectedProviderCartAction(text:string):BrowserCommand|null{
  const raw=String(text||'').trim()
  if(!raw)return null
  const lower=raw.toLowerCase()
  // Must be an explicit, affirmative "add <item> to cart/basket" — not negated.
  const wantsCart=/\badd\b[^.!?;,]*\bto\s+(?:my\s+|the\s+)?(?:cart|basket)\b/i.test(lower)
  if(!wantsCart)return null
  if(explicitlyNegates(lower,'add'))return null
  // Never let a cart action carry an order/payment/checkout. Those are human-only. Check
  // EACH forbidden action independently: a cart request is refused if ANY of them is
  // present and not explicitly negated (so "add to cart; do not order, but checkout and
  // pay" is refused because checkout/pay are affirmative even though order is negated).
  const forbiddenActions=['order','buy','purchase','checkout','check\\s*out','pay','payment']
  for(const verb of forbiddenActions){
    if(new RegExp(`\\b(?:${verb})\\b`,'i').test(lower) && !explicitlyNegates(lower,verb))return null
  }
  if(/\bplace\s+(?:the\s+|my\s+|an?\s+)?order\b/i.test(lower) && !explicitlyNegates(lower,'place'))return null
  // A contrast marker re-introduces an affirmative action even if an earlier clause
  // negated one ("do not order, BUT checkout and pay" must be refused).
  if(/\b(?:but|however|instead|yet|except)\b[^.!?]*\b(?:order|buy|purchase|checkout|check\s*out|pay|payment)\b/i.test(lower))return null
  const shoppingSites=[
    {alias:/\bblinkit\b/i,loginUrl:'https://blinkit.com/'},
    {alias:/\b(?:swiggy\s+)?instamart\b/i,loginUrl:'https://www.swiggy.com/instamart'},
    {alias:/\bzepto\b/i,loginUrl:'https://www.zepto.com/'},
  ].filter(site=>site.alias.test(raw))
  const vaultCandidates=Object.values(VAULT_PROVIDERS).map(provider=>({
    alias:new RegExp('\\b(?:'+(provider.aliases||[provider.key]).map(name=>name.replace(/\./g,'\\.')).join('|')+')\\b','i'),
    loginUrl:provider.loginUrl,
  })).filter(provider=>provider.alias.test(raw))
  const candidates=[...shoppingSites,...vaultCandidates]
  if(candidates.length!==1)return null
  return {
    url:candidates[0].loginUrl,
    objective:safe(raw.replace(/\b(ask\s+(?:me\s+)?for\s+(?:my\s+)?area\s+and\s+)pin\s+code(?=\s+if\s+(?:needed|required)\b)/gi,'$1postal code'),1800),
    mode:'execute',
    risk:'high',
    approvalAction:'submit_form',
  }
}

export function isExplicitProviderBrowserRead(text:string){
  const raw=String(text||'').trim()
  const providerSearch=providerContentSearch(raw)
  const nativeObject=/\b(?:email|mail|gmail|notes?|memory|memories|lists?|tasks|todos|to-dos|reminders?|calendar)\b|\b(?:my|our)\s+(?:(?:next|upcoming|scheduled)\s+)?(?:appointments?|meetings?|events?)\b/i
  const hasNativeObject=(value:string)=>nativeObject.test(value.replace(/\b(?:for|about|from|by|mentioning)\s+(?:(?!\b(?:and|then|but)\b)[^.!?;,])*/gi,''))
  const searchTarget=providerSearch&&!hasNativeObject(providerSearch[1])?providerSearch[2]:undefined
  const directNavigation=raw.match(/^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:open|browse|visit|show(?:\s+me)?|search(?!\s+for\b)|navigate\s+to|go\s+to)\s+(.+)$/i)?.[1]||''
  const target=startsWithProviderTarget(directNavigation)?directNavigation:searchTarget||directNavigation
  if(!target)return false
  const navigationTarget=normalizeProviderTarget(target)
  if(hasNativeObject(navigationTarget))return false
  const directTarget=startsWithProviderTarget(navigationTarget)
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
  const persistentCommerce=Boolean(runMetadata.commerce_parent_id||runMetadata.comparison_parent_id)&&params.mode==='read'
  const browserOwner=persistentCommerce?params.actor.userId+':commerce':params.actor.userId
  const resumePage=persistentCommerce&&Boolean(runMetadata.handoff)
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
    const result=reconciledResult||await runSecureBrowser({reservePasswordHandoff:true,reserveHumanHandoff:true,userId:params.actor.userId,url:params.command.url,objective:params.command.objective,mode:params.mode,vaultCredentialId:params.command.vaultCredentialId||null,...(persistentCommerce?{keepAlive:true,sessionTaskId:params.runId,resumePage}:{})})
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
      // Display URLs can be redacted. Use the validated original for operations
      // when redaction made the observed URL unusable.
      let continuationUrl=params.command.url
      try{const observed=new URL(result.url);if(['https:','http:'].includes(observed.protocol)&&!observed.username&&!observed.password&&!/redacted|withheld/i.test(result.url))continuationUrl=observed.href}catch{}
      await activity(tg,params.runId,blockReason,blockReason==='delivery_location_required'?'Gogo needs a delivery location before looking up availability.':blockReason==='human_auth_required'?'Gogo paused at a human authentication boundary.':'Gogo paused because the provider limited automated access.',{host:new URL(continuationUrl).hostname,auth_reason:result.authReason||null})
      if(blockReason==='provider_access_limited'&&runMetadata.browser_safe_to_retry===false){
        const outcome=await (await import('./post-auth-outcome')).markAuthOutcomeUnknown(String(tg),params.runId,runMetadata)
        return {...outcome,capability:'browser' as const,risk:params.command.risk,handledBy:'secure-browser' as const}
      }
      if(blockReason==='human_auth_required'||blockReason==='delivery_location_required'){
        if((result.handoffReservation||(result.authReason&&result.authReason!=='password'))&&!result.credentialSelectionRequired){
          const {startProviderBrowserHandoff,cancelProviderBrowserHandoff}=await import('./provider-browser-handoff')
          const handoff=await startProviderBrowserHandoff({userId:browserOwner,url:continuationUrl,originalUrl:params.command.url,reservationToken:result.handoffReservation,sessionTaskId:params.runId,...(persistentCommerce?{keepAlive:true}:{})})
          const {error}=await supabaseAdmin.from('agent_runs').update({metadata_json:{...runMetadata,handoff},completed_at:null}).eq('id',params.runId).eq('telegram_id',String(tg))
          if(error){
            await cancelProviderBrowserHandoff(browserOwner,handoff).catch(()=>{})
            throw new Error('browser_handoff_save_failed')
          }
          const appBase=String(process.env.NEXT_PUBLIC_APP_URL||process.env.APP_URL||'https://app.askgogo.in').replace(/\/$/,'')
          const resumeUrl=`${appBase}/dashboard/activity/${encodeURIComponent(params.runId)}/browser`
          return {
            runId:params.runId,status:'paused' as const,capability:'browser' as const,risk:params.command.risk,
            text:`${result.summary}\n\nOpen this task to Take control, complete the human-only step, then select Resume this task:\n${resumeUrl}\n\nDo not paste passwords or one-time codes into chat. Gogo keeps this same task and rechecks permissions before continuing.`,
            blockedReason:blockReason,handledBy:'secure-browser' as const,
          }
        }
        if(blockReason==='delivery_location_required')return {runId:params.runId,status:'paused' as const,capability:'browser' as const,risk:params.command.risk,text:result.summary,blockedReason:blockReason,handledBy:'secure-browser' as const}
        const host=new URL(continuationUrl).hostname
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
        text:`${result.summary}\n\nNo provider-side action was made.`,
        blockedReason:'provider_access_limited' as const,handledBy:'secure-browser' as const,
      }
    }

    const candidateSource=result.sourceUrl||result.url
    let sourceUrl=''
    try{
      const source=new URL(candidateSource)
      if(['https:','http:'].includes(source.protocol)&&!source.username&&!source.password&&!source.search&&!source.hash&&!/redacted|withheld/i.test(candidateSource))sourceUrl=source.toString()
    }catch{}
    const sourceText=sourceUrl?'\n\nSource: '+sourceUrl:''
    const compact={url:result.url,...(sourceUrl?{sourceUrl}:{}),title:result.title,summary:result.summary,formCount:result.forms.length,actions:result.actions}
    await supabaseAdmin.from('agent_steps').update({status:'completed',output_json:compact,error:null,completed_at:at}).eq('id',params.stepId)
    await supabaseAdmin.from('agent_runs').update({status:'completed',summary:safe(`${result.summary} ${result.title}`,1600)+sourceText,progress:100,completed_at:at,error:null,updated_at:at}).eq('id',params.runId).eq('telegram_id',String(tg))
    await activity(tg,params.runId,'run_completed',result.summary,{host:new URL(sourceUrl||params.command.url).hostname,action_count:result.actions.length})
    return {runId:params.runId,status:'completed' as const,capability:'browser' as const,risk:params.command.risk,text:`${result.summary}\n\n${result.title}${sourceText}\n${params.mode==='read'?'':safe(result.pageText,1800)}`,handledBy:'secure-browser' as const}
  }catch(err:any){
    if(pendingHandoffReservation)await (await import('./provider-browser-handoff')).cancelBrowserHandoffReservation(browserOwner,pendingHandoffReservation).catch(()=>{})
    if(err?.browserExecutionStarted===true)runMetadata.browser_safe_to_retry=false
    if(runMetadata.browser_safe_to_retry===false){
      const outcome=await (await import('./post-auth-outcome')).markAuthOutcomeUnknown(String(tg),params.runId,runMetadata)
      return {...outcome,capability:'browser' as const,risk:params.command.risk,handledBy:'secure-browser' as const}
    }
    const message=String(err?.message||'secure_browser_failed');const at=new Date().toISOString()
    const failureSummary=params.mode==='read'?browserFailureSummary(message):'Gogo could not complete the secure browser session.'
    const readDiagnostics=params.mode==='read'?sanitizeBrowserReadDiagnostics(err?.browserReadDiagnostics):[]
    await Promise.resolve(supabaseAdmin.from('agent_steps').update({status:'failed',error:safe(message,500),...(readDiagnostics.length?{output_json:{diagnostics:readDiagnostics}}:{}),completed_at:at}).eq('id',params.stepId)).catch(()=>{})
    await Promise.resolve(supabaseAdmin.from('agent_runs').update({status:'failed',summary:failureSummary,error:safe(message,500),completed_at:at,updated_at:at}).eq('id',params.runId).eq('telegram_id',String(tg))).catch(()=>{})
    await activity(tg,params.runId,'run_failed','Secure browser session failed.',{error:safe(message,250)})
    if(message.includes('browser_live_session_expired')){
      const summary=params.mode==='read'?failureSummary:'The live browser page expired or was replaced by another task. Open this comparison and choose your account or delivery location again. No cart or order was changed by this read.'
      await supabaseAdmin.from('agent_runs').update({summary}).eq('id',params.runId).eq('telegram_id',String(tg))
      return {runId:params.runId,status:'failed' as const,capability:'browser' as const,risk:params.command.risk,text:summary,handledBy:'secure-browser' as const}
    }
    if(message==='browser_read_deadline')return {runId:params.runId,status:'failed' as const,capability:'browser' as const,risk:params.command.risk,text:failureSummary,handledBy:'secure-browser' as const}
    if(message==='browser_objective_unverified'||message==='browser_planning_failed')return {runId:params.runId,status:'failed' as const,capability:'browser' as const,risk:params.command.risk,text:params.mode==='read'?failureSummary:'I could not verify the information you requested from the provider page. This task is not complete; I have no verified result to report.',handledBy:'secure-browser' as const}
    throw err
  }
}

// Link a paused read before execution; a lost response must not spawn a second
// browser task. The normal resume path rechecks current permission and policy.
export async function prepareLinkedBrowserRead(params:{actor:AgentActor;surface:AgentSurface;url:string;objective:string;parentRunId:string;parentKind?:'comparison'}){
  const command:BrowserCommand={url:params.url,objective:safe(params.objective,1800),mode:'read',risk:'low'}
  const {runId}=await makeRun({...params,command})
  const parentKey=params.parentKind==='comparison'?'comparison_parent_id':'commerce_parent_id'
  const {data,error}=await supabaseAdmin.from('agent_runs').update({status:'paused',metadata_json:{plan_type:'secure_browser',url:command.url,objective:command.objective,mode:'read',risk:'low',[parentKey]:params.parentRunId}})
    .eq('id',runId).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('status','queued').select('id').maybeSingle()
  if(error||!data)throw new Error('commerce_browser_prepare_failed')
  return runId
}

export async function restoreReadBrowserHandoff(params:{actor:AgentActor;runId:string;linkedOnly?:boolean}){
  const owner=String(params.actor.legacyTelegramId)
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('id,status,metadata_json').eq('id',params.runId).eq('telegram_id',owner).eq('type','secure_browser').maybeSingle()
  const meta=run?.metadata_json
  const linked=Boolean(meta?.commerce_parent_id||meta?.comparison_parent_id)
  const standalone=!params.linkedOnly&&!linked&&run?.status==='paused'&&meta?.plan_type==='secure_browser'&&Boolean(meta?.handoff?.takeoverUrl)
  if(error||!run||!['paused','completed','failed'].includes(run.status)||meta?.mode!=='read'||(!linked&&!standalone)||meta.browser_safe_to_retry===false)throw new Error('browser_control_unavailable')
  let target:URL
  try{target=new URL(String(meta.url||''))}catch{throw new Error('browser_control_unavailable')}
  if(!['https:','http:'].includes(target.protocol)||target.username||target.password||!target.hostname||target.hostname==='localhost'||target.hostname.endsWith('.local'))throw new Error('browser_control_unavailable')
  if(meta.comparison_parent_id){
    const {assertComparisonChild}=await import('@/lib/commerce/price-comparison')
    await assertComparisonChild(owner,String(meta.comparison_parent_id),run.id)
  }else{
    const {readCommerceTask}=await import('@/lib/commerce/task')
    const parent=await readCommerceTask(owner,meta.commerce_parent_id)
    if(!parent||parent.metadata_json.state!=='browser_research'||!Object.values(parent.metadata_json.browser_runs||{}).includes(run.id))throw new Error('commerce_parent_unavailable')
  }
  const policy=evaluateAgentExecutionPolicy({capability:'browser',permissionLevel:await permission(params.actor.legacyTelegramId),mode:'read',risk:'low',irreversible:false,approvalStatus:null})
  if(!policy.allowed)throw new Error('browser_control_permission_blocked')
  const {browserHandoffIsLive}=await import('./browser-handoff-health')
  if(run.status==='paused'&&await browserHandoffIsLive(meta.handoff?.takeoverUrl))return
  const {startProviderBrowserHandoff,cancelProviderBrowserHandoff}=await import('./provider-browser-handoff')
  const browserOwner=linked?params.actor.userId+':commerce':params.actor.userId
  const handoff=await startProviderBrowserHandoff({userId:browserOwner,url:target.toString(),sessionTaskId:run.id,...(linked?{keepAlive:true}:{})})
  let update=supabaseAdmin.from('agent_runs').update({status:'paused',metadata_json:{...meta,handoff},summary:'Complete the human step in the provider browser, then resume this same task. Do not send login codes in chat.',completed_at:null,updated_at:new Date().toISOString()})
    .eq('id',run.id).eq('telegram_id',owner).eq('status',run.status)
  // A second restore must not overwrite a newer handoff on the same run.
  update=meta.handoff?.token?update.contains('metadata_json',{handoff:{token:meta.handoff.token}}):update.is('metadata_json->handoff',null)
  const {data:saved,error:saveError}=await update.select('id').maybeSingle()
  if(saveError||!saved){await cancelProviderBrowserHandoff(browserOwner,handoff).catch(()=>{});throw new Error('browser_control_save_failed')}
}

// Commerce's direct take-control action must remain tied to its saved parent.
export async function takeControlOfCommerceRead(params:{actor:AgentActor;runId:string}){
  return restoreReadBrowserHandoff({...params,linkedOnly:true})
}

// An overlapping read must point at the existing task, not create a second
// run that fails the owner browser lock. Terminal and stale runs are not reused.
async function findActiveBrowserRead(owner:string,command:BrowserCommand){
  if(command.mode!=='read')return null
  const {data,error}=await supabaseAdmin.from('agent_runs').select('id,status,summary')
    .eq('telegram_id',owner).eq('type','secure_browser').eq('status','running')
    .eq('metadata_json->>mode','read').eq('metadata_json->>url',command.url)
    .eq('metadata_json->>objective',command.objective)
    .gte('started_at',new Date(Date.now()-10*60_000).toISOString())
    .order('started_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw new Error('browser_active_read_lookup_failed')
  return data
}

export async function runBrowserCommand(params:{actor:AgentActor;surface:AgentSurface;command:BrowserCommand}){
  const command=params.command
  const sentinel=evaluateAgentSentinel({capability:'browser',mode:command.mode,risk:command.risk,irreversible:command.mode==='execute',approved:false,instruction:command.objective,url:command.url,actionCount:12})
  if(!sentinel.allowed && sentinel.reason!=='approval_missing'){
    return {runId:'',status:'paused' as const,capability:'browser' as const,risk:command.risk,text:`Gogo Sentinel blocked this browser request: ${sentinel.reason}`,handledBy:'secure-browser' as const}
  }

  const tg=params.actor.legacyTelegramId
  const existing=await findActiveBrowserRead(String(tg),command)
  if(existing)return {runId:existing.id,status:'running' as const,capability:'browser' as const,risk:command.risk,
    text:'I’m still working on this same browser task. You do not need to send it again.\nTask progress: https://app.askgogo.in/dashboard/activity/'+existing.id,handledBy:'secure-browser' as const}
  const {runId,stepId}=await makeRun({actor:params.actor,surface:params.surface,command})
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

export async function tryRunBrowserCommand(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const command=parseConnectedProviderCartAction(params.text)||parseBrowserCommand(params.text)||parseConnectedProviderReadCommand(params.text)
  if(!command)return null
  return runBrowserCommand({actor:params.actor,surface:params.surface,command})
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

  if(meta.comparison_parent_id){
    if(mode!=='read')throw new Error('comparison_read_only')
    const {assertComparisonChild}=await import('@/lib/commerce/price-comparison')
    await assertComparisonChild(String(tg),String(meta.comparison_parent_id),run.id)
  }

  if(meta.commerce_parent_id){
    const {readCommerceTask}=await import('@/lib/commerce/task')
    const parent=await readCommerceTask(String(tg),String(meta.commerce_parent_id))
    if(!parent||parent.metadata_json.state!=='browser_research'||!Object.values(parent.metadata_json.browser_runs||{}).includes(run.id))throw new Error('commerce_parent_unavailable')
  }

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

