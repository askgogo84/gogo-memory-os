// AskGogo Feature Intent Router
// Existing deterministic routing remains byte-for-byte in feature-intents-legacy.
// Muse-style Agent handling runs ONLY when legacy routing declines the turn.

import { routeFeatureIntent as routeLegacyFeatureIntent } from '@/lib/feature-intents-legacy'
import { tryRunWhatsAppAgent } from '@/lib/agent/whatsapp-bridge'
import { dispatchThroughSameBrain } from '@/lib/agent/same-brain'
import { registerLifeEvent } from '@/lib/agent/life-event-engine'
import { buildGmailConnectUrl } from '@/lib/google-gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isBookingOrEventLinkText } from '@/lib/services/whatsapp-preview-routing'
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

function firstUrl(text:string) {
  const match=String(text||'').match(/https?:\/\/[^\s<>]+/i)
  return match ? match[0].replace(/[),.;!?]+$/,'') : ''
}

function bookingProvider(text:string,url:string) {
  const hay=`${text} ${url}`.toLowerCase()
  if(/bookmyshow|bmsurl\.co/.test(hay))return 'BookMyShow'
  if(/district\.in/.test(hay))return 'District'
  if(/insider\.in/.test(hay))return 'Insider'
  if(/paytm\.com/.test(hay))return 'Paytm'
  return 'Booking provider'
}

function bookingTitle(text:string) {
  const raw=String(text||'').replace(/https?:\/\/\S+/gi,' ').replace(/\s+/g,' ').trim()
  const watching=raw.match(/we(?:'|’)re\s+watching\s+(.+?)(?=\.\s*(?:find|here|ticket)|\s+find\s+ticket|$)/i)
  if(watching?.[1])return watching[1].trim().slice(0,180)
  const details=raw.match(/booking\s+details\s*[-–:]\s*(.+?)(?=\.|$)/i)
  if(details?.[1] && !/bookmyshow/i.test(details[1]))return details[1].trim().slice(0,180)
  const movie=raw.match(/\b(?:movie|film)\s*[:\-]\s*(.+?)(?=\.|$)/i)
  if(movie?.[1])return movie[1].trim().slice(0,180)
  return 'Event booking'
}

async function handleBookingEventLink(text:string,telegramId:number) {
  if(!isBookingOrEventLinkText(text))return null
  const url=firstUrl(text)
  const provider=bookingProvider(text,url)
  const title=bookingTitle(text)

  try {
    await registerLifeEvent({
      telegramId,
      eventType:'event',
      subtype:/movie|watching|cinema|theatre/i.test(text)?'movie_booking':'event_booking',
      source:'whatsapp_booking_link',
      title,
      provider,
      metadata:{ bookingUrl:url||null, schedulePending:true },
      sourceRefs:url ? [{ source:'whatsapp', kind:'booking_link', url }] : [{ source:'whatsapp', kind:'booking_text' }],
    })
  } catch(err:any) {
    // Recognition should still work even if persistence has a transient failure.
    console.error('BOOKING_LINK_LIFE_EVENT_SAVE_FAILED:',err?.message||err)
  }

  return `🎟️ *Booking received*\n\n*${title}*\n${provider}${url?`\n${url}`:''}\n\nI’ve recognised this as an event booking — not a photo/document. I’ll keep it with your events.\n\nIf the forwarded message doesn’t include the *date, time and venue*, send the booking confirmation/screenshot and I’ll complete the event details and calendar flow.`
}

export async function routeFeatureIntent(
  phone: string,
  text: string,
  extra?: { telegramId?: number; caption?: string },
): Promise<string | null> {
  // Booking/event links are deterministic first-class inputs. They must beat generic
  // URL/image handling so WhatsApp preview thumbnails cannot become fake documents.
  if(extra?.telegramId) {
    const booking=await handleBookingEventLink(text,extra.telegramId)
    if(booking)return booking
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

    // Simple private reads should work on WhatsApp too, even though they are not
    // multi-tool Agent missions. Reuse the exact same deterministic server-side
    // Workspace reader as Dashboard/Agent so every surface is one Gogo.
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
    // Agent enhancement must never break the mature WhatsApp fallback path.
    console.error('WHATSAPP_AGENT_BRIDGE_FAILED:', err?.message || err)
    return null
  }
}
