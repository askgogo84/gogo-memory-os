import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { routeFeatureIntent as routeLegacyFeatureIntent } from '@/lib/feature-intents-legacy'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { buildGmailConnectUrl } from '@/lib/google-gmail'
import { readWorkspaceDriveText, readWorkspaceEmailBrief, searchWorkspaceContacts, searchWorkspaceDrive, searchWorkspaceEmails } from './google-workspace-read'
import type { AgentActor } from './actor'

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

function isEmailRead(text:string) {
  return /\b(email|emails|gmail|inbox|mail)\b/i.test(text) && /\b(find|show|read|latest|recent|unread|search|look for|check|attached|attachment|brief)\b/i.test(text) && !/\b(send|forward|compose)\b/i.test(text)
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

async function tryWorkspaceRead(actor:AgentActor,text:string):Promise<string|null> {
  try {
    if(isEmailRead(text)) {
      const result=await searchWorkspaceEmails(actor,text)
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

      const lines=result.messages.slice(0,5).map((m:any,index:number)=>`${index+1}. ${m.subject}\nFrom: ${m.from}${m.date?`\nDate: ${m.date}`:''}${m.snippet?`\n${m.snippet}`:''}`)
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
  actor: AgentActor
  text: string
  messageId?: string | number | null
}): Promise<SameBrainResult> {
  const text = String(params.text || '').trim().slice(0, 2000)
  if (!text) throw new Error('empty_agent_request')

  const workspaceReply=await tryWorkspaceRead(params.actor,text)
  if(workspaceReply) {
    return {
      text:redactSecretShapedText(workspaceReply),
      mediaUrl:null,
      mediaType:null,
      handledBy:'same-brain',
    }
  }

  const featureReply = await routeLegacyFeatureIntent(params.actor.whatsappId, text, {
    telegramId: params.actor.legacyTelegramId,
    caption: text,
  })

  if (featureReply) {
    await saveFeatureConversation(params.actor.legacyTelegramId, text, featureReply)
    return {
      text: redactSecretShapedText(featureReply),
      mediaUrl: null,
      mediaType: null,
      handledBy: 'feature-intent',
    }
  }

  const result = await processIncomingMessage({
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
