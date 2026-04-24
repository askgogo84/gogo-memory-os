import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { sendWhatsAppMessage, sendWhatsAppMediaMessage } from '@/lib/channels/whatsapp'
import { resolveUser } from '@/lib/bot/resolve-user'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDirectWhatsappPremiumReply } from '@/lib/bot/handlers/whatsapp-direct-premium'
import { normalizeVoicePromptForBot } from '@/lib/bot/handlers/voice-normalizer'
import {
  isAudioContentType,
  transcribeTwilioVoiceNote,
} from '@/lib/services/voice-transcription'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  return (value || '').replace(/^whatsapp:/, '').trim()
}

function emptyTwiml() {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
}

async function saveConversation(
  telegramId: number,
  role: 'user' | 'assistant',
  content: string
) {
  await supabaseAdmin.from('conversations').insert({
    telegram_id: telegramId,
    role,
    content,
  })
}

async function saveMemory(telegramId: number, content: string) {
  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content,
  })
}

async function getTextFromIncomingWhatsApp(formData: FormData) {
  const bodyRaw = String(formData.get('Body') || '').trim()
  const numMedia = Number(formData.get('NumMedia') || '0')

  if (bodyRaw) {
    return {
      text: bodyRaw,
      wasVoice: false,
      voiceTranscript: null as string | null,
    }
  }

  if (numMedia <= 0) {
    return {
      text: '',
      wasVoice: false,
      voiceTranscript: null as string | null,
    }
  }

  const mediaUrl = String(formData.get('MediaUrl0') || '')
  const contentType = String(formData.get('MediaContentType0') || '')

  if (!mediaUrl || !isAudioContentType(contentType)) {
    return {
      text: '',
      wasVoice: false,
      voiceTranscript: null as string | null,
    }
  }

  const transcript = await transcribeTwilioVoiceNote({
    mediaUrl,
    contentType,
  })

  return {
    text: transcript,
    wasVoice: true,
    voiceTranscript: transcript,
  }
}

function addVoicePrefix(reply: string, transcript: string) {
  const cleanTranscript =
    transcript.length > 120 ? transcript.slice(0, 117).trim() + '...' : transcript

  return `🎙️ *Heard you via voice note*\n“${cleanTranscript}”\n\n${reply}`
}

function shouldSendThinkingMedia(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    lower === 'today' ||
    lower === 'morning briefing' ||
    lower === 'today briefing' ||
    lower === 'today summary' ||
    lower.includes('show my unread') ||
    lower.includes('unread emails') ||
    lower.includes('latest emails') ||
    lower.includes('latest mail') ||
    lower.includes('reply to latest') ||
    lower.includes('reply to the latest') ||
    lower.includes('summarize my emails') ||
    lower.includes('summarize my mails')
  )
}

async function sendThinkingIfNeeded(from: string, text: string) {
  if (!shouldSendThinkingMedia(text)) return

  try {
    await sendWhatsAppMessage(from, '🧘 Working on it…')
  } catch (error: any) {
    console.error('WHATSAPP_THINKING_TEXT_FAILED:', {
      error: error?.message || error,
    })
  }

  const thinkingUrl = process.env.ASKGOGO_THINKING_GIF_URL

  if (!thinkingUrl) return

  try {
    await sendWhatsAppMediaMessage(from, ' ', thinkingUrl)
  } catch (error: any) {
    console.error('WHATSAPP_THINKING_MEDIA_FAILED:', {
      mediaUrl: thinkingUrl,
      error: error?.message || error,
    })
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (
    mode === 'subscribe' &&
    token &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge || 'OK', { status: 200 })
  }

  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()

    const fromRaw = String(formData.get('From') || '')
    const profileName = String(formData.get('ProfileName') || 'Friend')
    const numMedia = Number(formData.get('NumMedia') || '0')
    const from = normalizeWhatsAppNumber(fromRaw)

    console.log('WhatsApp inbound:', {
      fromRaw,
      from,
      profileName,
      numMedia,
      body: String(formData.get('Body') || ''),
      mediaType: String(formData.get('MediaContentType0') || ''),
    })

    if (!from) {
      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    let incoming

    try {
      incoming = await getTextFromIncomingWhatsApp(formData)
    } catch (error: any) {
      console.error('WhatsApp voice transcription failed:', error)

      await sendWhatsAppMessage(
        from,
        `I couldn’t understand that voice note clearly.\n\nPlease try again with a shorter voice note, or type the message once.`
      )

      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    const originalText = incoming.text.trim()
    const text = incoming.wasVoice ? normalizeVoicePromptForBot(originalText) : originalText

    if (!text) {
      await sendWhatsAppMessage(
        from,
        `I can read text and voice notes right now.\n\nPlease send a short voice note or type your request.`
      )

      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    const resolvedUser = await resolveUser({
      channel: 'whatsapp',
      externalUserId: from,
      userName: profileName,
    })

    const directReply = getDirectWhatsappPremiumReply(text, resolvedUser.name)

    if (directReply) {
      await saveConversation(
        resolvedUser.telegramId,
        'user',
        incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text
      )

      if (directReply.saveMemory) {
        await saveMemory(resolvedUser.telegramId, directReply.saveMemory)
      }

      const finalReply =
        incoming.wasVoice && incoming.voiceTranscript
          ? addVoicePrefix(directReply.text, originalText)
          : directReply.text

      await saveConversation(resolvedUser.telegramId, 'assistant', finalReply)

      await sendWhatsAppMessage(from, finalReply)

      if (directReply.mediaUrl) {
        try {
          await sendWhatsAppMediaMessage(from, ' ', directReply.mediaUrl)
        } catch (mediaError: any) {
          console.error('WHATSAPP_PREMIUM_MEDIA_FAILED:', {
            mediaUrl: directReply.mediaUrl,
            error: mediaError?.message || mediaError,
          })
        }
      }

      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    await sendThinkingIfNeeded(from, text)

    const result = await processIncomingMessage({
      channel: 'whatsapp',
      externalUserId: from,
      text,
      userName: profileName,
      messageType: incoming.wasVoice ? 'voice' : 'text',
    })

    const finalReply =
      incoming.wasVoice && incoming.voiceTranscript
        ? addVoicePrefix(result.text, originalText)
        : result.text

    await sendWhatsAppMessage(from, finalReply)

    return new NextResponse(emptyTwiml(), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (error: any) {
    console.error('WhatsApp webhook error:', error)

    return new NextResponse(emptyTwiml(), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
