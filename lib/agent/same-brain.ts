import { randomUUID } from 'crypto'
import { cleanEmailSnippet, formatEmailDateIST, wantsSingleLatestEmail } from './email-format'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rememberTypedObjects } from './typed-object-context'
import { routeFeatureIntent as routeLegacyFeatureIntent } from '@/lib/feature-intents-legacy'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { buildGmailConnectUrl, revokeGoogleToken } from '@/lib/google-gmail'
import { formatWorkspaceEmailAudit, readWorkspaceDriveText, readWorkspaceEmailBrief, searchWorkspaceContacts, searchWorkspaceDrive, searchWorkspaceEmails } from './google-workspace-read'
import { clearFollowupState, saveFollowupState } from '@/lib/bot/handlers/followup-state'
import type { AgentActor } from './actor'
import { decryptGoogleToken } from '@/lib/security/google-token-crypto'

export type SameBrainResult = {
  text: string
  mediaUrl?: string | null
  mediaType?: string | null
  handledBy: 'feature-intent' | 'same-brain'
}

async function saveFeatureConversation(telegramId: number, userText: string, assistantText: string) {
  const { error } = await supabaseAdmin.from('conversations').insert([
    { telegram_id: telegramId, role: 'user', content: userText },
    { telegram_id: telegramId, role: 'assistant', content: assistantText },
  ])
  if (error) console.error('AGENT_FEATURE_CONVERSATION_SAVE_FAILED:', error.message)
}

function workspaceConnectionReply(actor:AgentActor) {
  const url=buildGmailConnectUrl(actor.legacyTelegramId)
  return url
    ? `Google Workspace needs to be connected or refreshed before I can read that private context.\n\nConnect read-only Gmail, Contacts and Drive here:\n${url}\n\nSending email, changing files and scheduling still require the normal Gogo approval boundary.`
    : 'Google Workspace connection is temporarily unavailable. I did not guess or use another account.'
}

function isWorkspaceDisconnect(text:string) {
  const lower=String(text||'').trim().toLowerCase()
  return /^(?:disconnect|unlink|remove)\s+(?:my\s+)?(?:google(?:\s+workspace)?|gmail)(?:\s+(?:account|connection))?[?!.]*$/.test(lower)
}

async function disconnectWorkspace(actor:AgentActor) {
  const {data,error}=await supabaseAdmin.from('users')
    .select('gmail_access_token,gmail_refresh_token,gmail_connected,google_refresh_token,google_calendar_connected')
    .eq('telegram_id',actor.legacyTelegramId)
    .maybeSingle()
  if(error)throw new Error(`workspace_disconnect_read_failed:${error.message}`)

  // Extra linked Google Calendar accounts live in their own table. A missing table
  // (older environments) simply yields no extras — never block the disconnect.
  const {data:extraAccountsData}=await supabaseAdmin.from('google_calendar_accounts')
    .select('email,refresh_token')
    .eq('telegram_id',String(actor.legacyTelegramId))
  const extraAccounts=Array.isArray(extraAccountsData)?extraAccountsData:[]

  const gmailConnected=!!(data?.gmail_connected||data?.gmail_access_token||data?.gmail_refresh_token)
  const calendarConnected=!!(data?.google_calendar_connected||data?.google_refresh_token||extraAccounts.length)
  if(!gmailConnected && !calendarConnected) {
    return 'Google is already disconnected from AskGogo.'
  }

  // Gmail and Google Calendar are authorised under the SAME Google OAuth client
  // (GOOGLE_CLIENT_ID) but AskGogo stores a SEPARATE refresh token for each:
  // Gmail in users.gmail_refresh_token, the primary Calendar account in
  // users.google_refresh_token, and any extra calendars in google_calendar_accounts.
  // "Disconnect my Google account" must revoke EVERY stored Google token and clear
  // BOTH the Gmail and Calendar state. Clearing only Gmail (the old behaviour) left
  // the account reading as calendar-connected and kept a live calendar token — Bug F.
  const stored=String(data?.gmail_refresh_token||data?.gmail_access_token||'')
  const token=stored ? decryptGoogleToken(stored) : ''
  const revoked=await revokeGoogleToken(token)

  const revokeStoredToken=async (value?:string|null)=>{
    const raw=String(value||'')
    if(!raw)return true
    try { return await revokeGoogleToken(decryptGoogleToken(raw)) } catch { return false }
  }
  const calendarRevoked=await revokeStoredToken(data?.google_refresh_token)
  let extrasRevoked=true
  for(const acc of extraAccounts) {
    if(!(await revokeStoredToken((acc as any)?.refresh_token))) extrasRevoked=false
  }

  const {error:clearError}=await supabaseAdmin.from('users').update({
    gmail_access_token:null,
    gmail_refresh_token:null,
    gmail_connected:false,
    gmail_connected_at:null,
    gmail_email:null,
    gmail_send_connected:false,
    gmail_send_connected_at:null,
    google_refresh_token:null,
    google_calendar_connected:false,
  }).eq('telegram_id',actor.legacyTelegramId)
  if(clearError)throw new Error(`workspace_disconnect_clear_failed:${clearError.message}`)

  if(extraAccounts.length) {
    const {error:extraClearError}=await supabaseAdmin.from('google_calendar_accounts')
      .delete().eq('telegram_id',String(actor.legacyTelegramId))
    if(extraClearError)throw new Error(`workspace_disconnect_extra_clear_failed:${extraClearError.message}`)
  }

  // Purge the transient typed-object cache (stored as agent_activity rows). It can
  // hold Gmail/Calendar-derived subjects and ids for ~30 minutes; after "disconnect"
  // it must not linger. One scoped delete alongside the token clears.
  await supabaseAdmin.from('agent_activity')
    .delete()
    .eq('telegram_id',String(actor.legacyTelegramId))
    .eq('event_type','typed_object_context')

  const allRevoked=revoked && calendarRevoked && extrasRevoked
  return allRevoked
    ? 'Google is disconnected from AskGogo. I removed the Gmail and Google Calendar access stored here.'
    : 'Google is disconnected from AskGogo — I removed the Gmail and Google Calendar access stored here. Google did not confirm remote revocation for every token, so also remove AskGogo from your Google Account permissions for certainty.'
}

function isEmailRead(text:string) {
  const actions=text.replace(/\b(?:do not|don't|never)\s+(?:cancel anything,\s*)?(?:send|forward|compose)\s+(?:any\s+)?(?:emails?|mail|anything)\b/gi,'')
  return /\b(email|emails|gmail|inbox|mail)\b/i.test(text) && /\b(audit|find|show|read|latest|recent|unread|search|look for|check|attached|attachment|brief)\b/i.test(text) && !/\b(send|forward|compose)\b/i.test(actions)
}
function wantsEmailAttachment(text:string) {
  return /\b(attached|attachment|attachments|brief|document|deck|proposal|pdf)\b/i.test(text)
}
function isContactRead(text:string) {
  return /\b(contact|contacts|email address|phone number|how do i reach|address for)\b/i.test(text) && /\b(find|show|look up|search|resolve|get|what is|what's)\b/i.test(text)
}
function isDriveRead(text:string) {
  return /\b(google drive|drive file|google doc|google sheet|in drive)\b/i.test(text) && /\b(find|show|read|search|open|use|look for|get)\b/i.test(text)
}

export function isGeneralInboxDigest(text:string){
  const t=String(text||'').toLowerCase()
  if(!/\b(?:summar(?:y|ise|ize)|digest|catch me up|what came in|unread|check (?:my )?(?:e-?mail|mail|inbox)|any (?:new|important|urgent) (?:e-?mails?|mails?)|my inbox)\b/.test(t))return false
  return !/\bfrom\s+[a-z0-9]|\babout\s+\w|\bregarding\b|\bsubject\b|\battach|\bbrief\b|\bpdf\b|\blatest (?:e-?mail|mail) from\b|\bpromo|\bnewsletter|\bsocial\b/.test(t)
}

async function tryWorkspaceRead(actor:AgentActor,text:string,missionText?:string):Promise<string|null> {
  try {
    if(isWorkspaceDisconnect(text)) return await disconnectWorkspace(actor)
    if(isEmailRead(text)) {
      // 24 Oct live: "Summarise my unread emails today" listed raw emails with signatures. A general inbox
      // digest (no sender/topic/attachment named) gets the attention card: only what needs the person, and why.
      if(isGeneralInboxDigest(text)){
        const store:any=await import('@/lib/email/attention-store').catch(()=>null)
        if(store?.buildAttentionCard){
          try{const card=await store.buildAttentionCard({legacyTelegramId:actor.legacyTelegramId,timezone:actor.timezone});if(card?.text)return card.text}
          catch(err:any){console.error('ATTENTION_DIGEST_FAILED:',String(err?.message||err).slice(0,160))}
        }
      }
      const result=await searchWorkspaceEmails(actor,text,{missionText})
      await rememberTypedObjects(actor.legacyTelegramId,'email',result.messages.slice(0,5).map((m:any)=>({id:String(m.id),title:String(m.subject||'Email')}))).catch(()=>{})
      if(result.audit)return formatWorkspaceEmailAudit(result)
      if(!result.messages.length)return 'I searched your connected Gmail and did not find a matching recent message. I did not invent one.'

      if(wantsEmailAttachment(text)) {
        const brief=await readWorkspaceEmailBrief(actor,result.messages,text)
        if(brief.status==='found') {
          const email=result.messages.find((m:any)=>m.subject===brief.subject)||result.messages[0]
          return `I found the matching email${email?.from?` from ${email.from}`:''}: ${brief.subject}\n\nAttached file: ${brief.filename}\n\n${brief.text.slice(0,5000)}`
        }
        if(brief.status==='ambiguous') {
          const choices=brief.attachments.map((a:any,index:number)=>`${index+1}. ${a.filename} — ${a.subject}`).join('\n')
          return `I found more than one equally plausible readable attachment. I won't guess which brief you mean:\n\n${choices}`
        }
        if(brief.status==='too_large')return `I found the attachment “${brief.filename}”, but it is larger than Gogo's safe read limit. I did not partially read it and pretend it was complete.`
        if(brief.status==='unreadable')return `I found the attachment “${brief.filename}”, but I couldn't extract reliable text from it. I did not invent its contents.`
        return 'I found matching email context, but no readable attachment matched the brief request. I did not substitute the email snippet for the document.'
      }

      const single=wantsSingleLatestEmail(text)
      const byNewest=[...result.messages].sort((a:any,b:any)=>(Date.parse(b.date||'')||0)-(Date.parse(a.date||'')||0))
      const shown=single?byNewest.slice(0,1):result.messages.slice(0,5)
      const lines=shown.map((m:any,index:number)=>{
        const date=formatEmailDateIST(m.date),snippet=cleanEmailSnippet(m.snippet)
        return `${single?'':`${index+1}. `}${m.subject}\nFrom: ${m.from}${date?`\nReceived: ${date}`:''}${snippet?`\n${snippet}`:''}`
      })
      await clearFollowupState(actor.legacyTelegramId,'gmail_search_results')
      await saveFollowupState(actor.legacyTelegramId,'gmail_search_results',{messages:result.messages.slice(0,6),created_at:new Date().toISOString()})
      if(result.messages.length===1||single){
        await clearFollowupState(actor.legacyTelegramId,'gmail_selected_message')
        await saveFollowupState(actor.legacyTelegramId,'gmail_selected_message',{message:single?shown[0]:result.messages[0],created_at:new Date().toISOString()})
      }
      if(single)return `Your latest matching email:\n\n${lines[0]}`
      return `I found these in your connected Gmail:\n\n${lines.join('\n\n')}`
    }
    if(isContactRead(text)) {
      const result=await searchWorkspaceContacts(actor,text)
      if(result.status==='missing_query')return 'Tell me whose contact you want me to look up.'
      if(result.status==='not_found')return `I couldn't find a matching Google contact for “${result.query}”. I did not guess an address.`
      if(result.status==='ambiguous') {
        const choices=result.contacts.slice(0,5).map((c:any,index:number)=>`${index+1}. ${c.name}${c.emails[0]?` — ${c.emails[0]}`:''}`).join('\n')
        return `I found more than one possible Google contact for “${result.query}”. I won't guess which person you mean:\n\n${choices}`
      }
      const contact=result.contacts[0]
      return `Google Contacts match:\n${contact.name}${contact.emails.length?`\n${contact.emails.join('\n')}`:''}`
    }
    if(isDriveRead(text)) {
      const result=await searchWorkspaceDrive(actor,text)
      if(!result.files.length)return 'I searched your connected Google Drive and did not find a matching file. I did not substitute another document.'
      if(result.files.length===1) {
        const file=result.files[0]
        const read=await readWorkspaceDriveText(actor,file)
        if(read.supported&&read.text)return `Google Drive: ${file.name}\n\n${read.text.slice(0,3500)}`
      }
      const lines=result.files.slice(0,6).map((f:any,index:number)=>`${index+1}. ${f.name}${f.modifiedTime?` — modified ${f.modifiedTime}`:''}`).join('\n')
      return `I found these matching files in your Google Drive:\n\n${lines}`
    }
  } catch(err:any) {
    const code=String(err?.message||'')
    if(code==='workspace_email_reading_disabled')return 'Gmail is connected, but reading is disabled in your saved privacy preference. I did not read your mail. Reconnecting Google will not change that preference.'
    if(['workspace_not_connected','workspace_reconnect_required','workspace_scope_required'].includes(code))return workspaceConnectionReply(actor)
    console.error('AGENT_WORKSPACE_READ_FAILED:',code.slice(0,120))
    return 'I could not read that Google Workspace context just now. I did not guess or fall back to another account.'
  }
  return null
}

/**
 * Planner steps use deterministic product stores first. Read-only Google
 * Workspace lookups are handled server-side before the mature legacy router, so
 * OAuth tokens never enter an LLM prompt or an Activity payload. We deliberately
 * DO NOT call the Agent-enhanced routeFeatureIntent wrapper because that wrapper
 * can start a new Agent mission; allowing a plan step to invoke it would create
 * planner → router → planner recursion and split one user outcome into nested runs.
 */
export async function dispatchThroughSameBrain(params: {
  internalStep?: boolean
  missionText?: string
  actor: AgentActor
  text: string
  messageId?: string | number | null
}): Promise<SameBrainResult> {
  const text = String(params.text || '').trim().slice(0, 2000)
  if (!text) throw new Error('empty_agent_request')

  const workspaceReply=await tryWorkspaceRead(params.actor,text,params.missionText)
  if(workspaceReply) {
    return {
      text:redactSecretShapedText(workspaceReply),
      mediaUrl:null,
      mediaType:null,
      handledBy:'same-brain',
    }
  }

  // Research asks get several searches, page reads and a cited answer (public web only).
  if(!params.internalStep){
    const dr:any=/\b(?:research|investigate|sources|citations|references)\b/i.test(text)?await import('./deep-research').catch(()=>null):null
    if(dr?.isDeepResearchRequest?.(text)){
      try{
        const out=await dr.runDeepResearch(text)
        if(out?.text){
          await saveFeatureConversation(params.actor.legacyTelegramId,text,out.text).catch(()=>{})
          return {text:redactSecretShapedText(out.text),mediaUrl:null,mediaType:null,handledBy:'same-brain'}
        }
      }catch(err:any){console.error('DEEP_RESEARCH_FAILED:',String(err?.message||err).slice(0,160))}
    }
  }

  const featureReply = await routeLegacyFeatureIntent(params.actor.whatsappId, text, {
    telegramId: params.actor.legacyTelegramId,
    caption: text,
  })

  if (featureReply) {
    if(!params.internalStep)await saveFeatureConversation(params.actor.legacyTelegramId, text, featureReply)
    return {
      text: redactSecretShapedText(featureReply),
      mediaUrl: null,
      mediaType: null,
      handledBy: 'feature-intent',
    }
  }

  const result = await processIncomingMessage({
    internalStep: params.internalStep,
    channel: 'whatsapp',
    externalUserId: params.actor.whatsappId,
    text,
    userName: params.actor.name || 'Gogo',
    messageType: 'text',
    messageId: params.messageId ?? `agent-step-${randomUUID()}`,
  })

  return {
    text: redactSecretShapedText(result.text),
    mediaUrl: result.mediaUrl || null,
    mediaType: result.mediaType || null,
    handledBy: 'same-brain',
  }
}
