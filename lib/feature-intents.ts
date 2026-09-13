// AskGogo Feature Intent Router
// Existing deterministic routing remains byte-for-byte in feature-intents-legacy.
// Muse-style Agent handling runs ONLY when legacy routing declines the turn.

import { routeFeatureIntent as routeLegacyFeatureIntent } from '@/lib/feature-intents-legacy'
import { tryRunWhatsAppAgent } from '@/lib/agent/whatsapp-bridge'
import { dispatchThroughSameBrain } from '@/lib/agent/same-brain'
import { isEventCredentialRetrieval, retrieveEventCredential } from '@/lib/agent/booking-closure'
import { queueBookingClosure } from '@/lib/agent/booking-queue'
import { buildGmailConnectUrl } from '@/lib/google-gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isBookingOrEventLinkText } from '@/lib/services/whatsapp-preview-routing'
import { sendWhatsAppMediaMessage } from '@/lib/channels/whatsapp'
import { addToListDetailed, formatAddResult, normalizeListName } from '@/lib/lists'
import { normalizeNaturalReminderSave, parseNumberedChecklist, saveNaturalReminder } from '@/lib/bot/handlers/natural-command-routing'
import type { ResolvedUser } from '@/lib/bot/resolve-user'

function isSimpleWorkspaceRead(text:string) {
  const t=String(text||'')
  const gmail=/\b(email|emails|gmail|inbox|mail)\b/i.test(t) && /\b(find|show|read|latest|recent|unread|search|look for|check|attached|attachment|brief)\b/i.test(t) && !/\b(send|forward|compose)\b/i.test(t)
  const contact=/\b(contact|contacts|email address|phone number|how do i reach|address for)\b/i.test(t) && /\b(find|show|look up|search|resolve|get|what is|what's)\b/i.test(t)
  const drive=/\b(google drive|drive file|google doc|google sheet|in drive)\b/i.test(t) && /\b(find|show|read|search|open|use|look for|get)\b/i.test(t)
  return gmail||contact||drive
}

function isWorkspaceConnect(text:string) {
  const t=String(text||'').toLowerCase()
  return /\b(connect|link|reconnect|refresh)\b/.test(t) && /\b(gmail|google workspace|google account|email)\b/.test(t)
}

export async function routeFeatureIntent(
  phone: string,
  text: string,
  extra?: { telegramId?: number; caption?: string },
): Promise<string | null> {
  // Retrieval stays synchronous because it is a bounded DB + signed-URL lookup.
  if (extra?.telegramId && isEventCredentialRetrieval(text)) {
    const ticket = await retrieveEventCredential(extra.telegramId, text)
    if (ticket) {
      await sendWhatsAppMediaMessage(phone, ticket.caption, ticket.mediaUrl).catch((err:any) => console.error('EVENT_TICKET_MEDIA_SEND_FAILED:', err?.message || err))
      return `Sent the provider-issued ticket/QR for *${ticket.title}*. It stays attached to the same Life Event.`
    }
  }

  // Full booking closure can open a real browser, inspect provider Share/QR actions
  // and reconcile Gmail. Never hold the 60-second WhatsApp webhook open for that.
  if (extra?.telegramId && isBookingOrEventLinkText(text)) {
    const queued = await queueBookingClosure({ telegramId: extra.telegramId, text, whatsappTo: phone })
    if (queued) return queued.text
  }

  // Natural user wording like "save this as reminder I travel on 27 September"
  // must never fall through to generic chat/notes. Convert it to the mature reminder
  // parser and persist it deterministically for the current user.
  if (extra?.telegramId && normalizeNaturalReminderSave(text)) {
    try {
      return await saveNaturalReminder({ telegramId: extra.telegramId, whatsappTo: phone, text })
    } catch (err:any) {
      console.error('NATURAL_REMINDER_SAVE_FAILED:', err?.message || err)
      return `I understood this as a reminder, but I couldn't save it just now. Please try once more — I won't save it as a note instead.`
    }
  }

  // Numbered trip/preparation checklists are first-class lists, not free-form notes.
  const checklist = extra?.telegramId ? parseNumberedChecklist(text) : null
  if (extra?.telegramId && checklist) {
    try {
      const listName = normalizeListName(checklist.listName)
      const result = await addToListDetailed(extra.telegramId, listName, checklist.items)
      return formatAddResult(listName, result)
    } catch (err:any) {
      console.error('NUMBERED_CHECKLIST_SAVE_FAILED:', err?.message || err)
      return `I recognised this as a checklist, but I couldn't save it just now. Please try once more — I won't turn it into an unrelated note.`
    }
  }

  const legacy = await routeLegacyFeatureIntent(phone, text, extra)
  if (legacy) return legacy
  if (!extra?.telegramId) return null

  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id,telegram_id,whatsapp_id,name,tier,timezone,platform')
      .eq('telegram_id', extra.telegramId)
      .maybeSingle()
    if (error) {
      console.error('WHATSAPP_AGENT_USER_LOOKUP_FAILED:', error.message)
      return null
    }
    if (!data?.id) return null

    const user: ResolvedUser = {
      id: data.id,
      channel: 'whatsapp',
      externalUserId: phone,
      telegramId: Number(data.telegram_id),
      whatsappId: String(data.whatsapp_id || phone),
      name: String(data.name || 'Friend'),
      tier: String(data.tier || 'free'),
      platform: 'whatsapp',
      timezone: String(data.timezone || 'Asia/Kolkata'),
      rawUser: data,
    }

    if (isWorkspaceConnect(text)) {
      const url=buildGmailConnectUrl(user.telegramId)
      return url
        ? `Connect Google Workspace here:\n${url}\n\nThis gives Gogo only the read-only Gmail, Contacts and Drive context you approve. Sending email, changing files or scheduling still requires the normal approval boundary.`
        : 'Google Workspace connection is temporarily unavailable. Please try again shortly.'
    }

    if (isSimpleWorkspaceRead(text)) {
      const actor={ userId:String(user.id),legacyTelegramId:user.telegramId, whatsappId:String(user.whatsappId||phone),name:String(user.name||'Gogo') }
      const result=await dispatchThroughSameBrain({actor,text})
      return result.text || null
    }

    const agent = await tryRunWhatsAppAgent({ user, text })
    return agent?.text || null
  } catch (err: any) {
    console.error('WHATSAPP_AGENT_BRIDGE_FAILED:', err?.message || err)
    return null
  }
}
