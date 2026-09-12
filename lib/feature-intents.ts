// AskGogo Feature Intent Router
// Existing deterministic routing remains byte-for-byte in feature-intents-legacy.
// Muse-style Agent handling runs ONLY when legacy routing declines the turn.

import { routeFeatureIntent as routeLegacyFeatureIntent } from '@/lib/feature-intents-legacy'
import { tryRunWhatsAppAgent } from '@/lib/agent/whatsapp-bridge'
import { dispatchThroughSameBrain } from '@/lib/agent/same-brain'
import { closeBookingLink, isEventCredentialRetrieval, retrieveEventCredential } from '@/lib/agent/booking-closure'
import { buildGmailConnectUrl } from '@/lib/google-gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isBookingOrEventLinkText } from '@/lib/services/whatsapp-preview-routing'
import { sendWhatsAppMediaMessage } from '@/lib/channels/whatsapp'
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
  // Ticket retrieval is deterministic and beats generic memory/search. The actual
  // provider-issued QR/PDF is sent as WhatsApp media, not reconstructed by Gogo.
  if (extra?.telegramId && isEventCredentialRetrieval(text)) {
    const ticket = await retrieveEventCredential(extra.telegramId)
    if (ticket) {
      await sendWhatsAppMediaMessage(phone, ticket.caption, ticket.mediaUrl).catch((err:any) => console.error('EVENT_TICKET_MEDIA_SEND_FAILED:', err?.message || err))
      return `Sent your saved provider-issued ticket/QR for *${ticket.caption.match(/\*([^*]+)\*/)?.[1] || 'the event'}*. I kept it attached to the same Life Event so you do not need to reopen the booking provider.`
    }
  }

  // Booking/event links are first-class missions. Resolve provider + connected Gmail
  // in parallel, capture the real credential, create reminder/calendar/change-watch,
  // and only then report the closure state.
  if (extra?.telegramId && isBookingOrEventLinkText(text)) {
    const booking = await closeBookingLink({ telegramId: extra.telegramId, text })
    if (booking) {
      if (booking.credentialUrl) {
        const caption = `${booking.details?.title ? `🎟️ ${booking.details.title}\n` : ''}Provider-issued ticket / QR saved by AskGogo.`
        await sendWhatsAppMediaMessage(phone, caption, booking.credentialUrl).catch((err:any) => console.error('BOOKING_CREDENTIAL_MEDIA_SEND_FAILED:', err?.message || err))
      }
      return booking.text
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
      const actor={
        userId:String(user.id),legacyTelegramId:user.telegramId,
        whatsappId:String(user.whatsappId||phone),name:String(user.name||'Gogo'),
      }
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
