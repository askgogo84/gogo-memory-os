import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { sendWhatsAppMessage, sendWhatsAppMediaMessage, sendWhatsAppTyping } from '@/lib/channels/whatsapp'
import { resolveUser } from '@/lib/bot/resolve-user'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { addToList } from '@/lib/lists'
import { getDirectWhatsappPremiumReply } from '@/lib/bot/handlers/whatsapp-direct-premium'
import { normalizeVoicePromptForBot } from '@/lib/bot/handlers/voice-normalizer'
import { buildMemoryControlReply, isMemoryControlCommand } from '@/lib/bot/handlers/memory-control'
import { buildNotesReply, isNotesCommand } from '@/lib/bot/handlers/notes-control'
import { buildPaymentIntentReply, isPaymentIntentCommand } from '@/lib/bot/handlers/payment-intent'
import { buildAdminWhatsAppReply, isAdminCommand, isAdminPhone } from '@/lib/bot/handlers/admin-analytics'
import { buildFirstValueReferralNudge } from '@/lib/bot/handlers/first-value-nudge'
import {
  buildReferralUnlockReply,
  buildReferralWelcomeNote,
  buildShareMyWinReply,
  isReferralCommand,
  isShareMyWinCommand,
  recordReferralJoinFromText,
} from '@/lib/bot/handlers/referral-unlock'
import { checkFeatureLimit, logUsage } from '@/lib/limits'
import {
  isAudioContentType,
  transcribeTwilioVoiceNote,
} from '@/lib/services/voice-transcription'
import {
  compactImageNoteForSaving,
  isImageContentType,
  readAndSummarizeImageNote,
} from '@/lib/services/image-note-reader'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  return (value || '').replace(/^whatsapp:/, '').trim()
}

function emptyTwiml() {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
}

async function saveConversation(telegramId: number, role: 'user' | 'assistant', content: string) {
  await supabaseAdmin.from('conversations').insert({ telegram_id: telegramId, role, content })
}

async function saveMemory(telegramId: number, content: string) {
  await supabaseAdmin.from('memories').insert({ telegram_id: telegramId, content })
}

async function sendWithFirstValueNudge(params: {
  from: string
  telegramId: number
  userText: string
  reply: string
}) {
  const nudge = await buildFirstValueReferralNudge({
    telegramId: params.telegramId,
    userText: params.userText,
    botReply: params.reply,
  })

  await sendWhatsAppMessage(params.from, `${params.reply}${nudge}`)
}

async function getTextFromIncomingWhatsApp(formData: FormData) {
  const bodyRaw = String(formData.get('Body') || '').trim()
  const numMedia = Number(formData.get('NumMedia') || '0')

  if (bodyRaw) return { text: bodyRaw, wasVoice: false, voiceTranscript: null as string | null }
  if (numMedia <= 0) return { text: '', wasVoice: false, voiceTranscript: null as string | null }

  const mediaUrl = String(formData.get('MediaUrl0') || '')
  const contentType = String(formData.get('MediaContentType0') || '')

  if (!mediaUrl || !isAudioContentType(contentType)) return { text: '', wasVoice: false, voiceTranscript: null as string | null }

  const transcript = await transcribeTwilioVoiceNote({ mediaUrl, contentType })
  return { text: transcript, wasVoice: true, voiceTranscript: transcript }
}

function addVoicePrefix(reply: string, transcript: string) {
  const cleanTranscript = transcript.length > 120 ? transcript.slice(0, 117).trim() + '...' : transcript
  return `🎙️ *Heard you via voice note*\n“${cleanTranscript}”\n\n${reply}`
}

function shouldSendThinkingMedia(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower === 'today' || lower === 'morning briefing' || lower === 'today briefing' || lower === 'today summary' ||
    lower.includes('show my unread') || lower.includes('unread emails') || lower.includes('latest emails') || lower.includes('latest mail') ||
    lower.includes('reply to latest') || lower.includes('reply to the latest') || lower.includes('summarize my emails') || lower.includes('summarize my mails') ||
    lower.includes('plan my day') || lower.includes('help me plan')
  )
}

async function sendThinkingIfNeeded(from: string, text: string) {
  if (!shouldSendThinkingMedia(text)) return
  try { await sendWhatsAppMessage(from, '🧘 Working on it…') } catch (error: any) { console.error('WHATSAPP_THINKING_TEXT_FAILED:', { error: error?.message || error }) }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
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
    const inboundMessageSid = String(formData.get('MessageSid') || formData.get('SmsMessageSid') || '').trim()
    const from = normalizeWhatsAppNumber(fromRaw)

    console.log('WhatsApp inbound:', { fromRaw, from, profileName, numMedia, messageSid: inboundMessageSid, body: String(formData.get('Body') || ''), mediaType: String(formData.get('MediaContentType0') || '') })

    if (!from) return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })

    if (inboundMessageSid) {
      sendWhatsAppTyping(inboundMessageSid).catch((error: any) => console.error('WHATSAPP_TYPING_BACKGROUND_FAILED:', error?.message || error))
    }

    const resolvedUser = await resolveUser({ channel: 'whatsapp', externalUserId: from, userName: profileName })
    const bodyText = String(formData.get('Body') || '').trim()

    if (isAdminCommand(bodyText)) {
      if (!isAdminPhone(from)) {
        await sendWhatsAppMessage(from, `Admin access is restricted.`)
        return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
      }

      const reply = await buildAdminWhatsAppReply(bodyText)
      await saveConversation(resolvedUser.telegramId, 'user', bodyText)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      await sendWhatsAppMessage(from, reply)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    const firstMediaUrl = String(formData.get('MediaUrl0') || '')
    const firstMediaType = String(formData.get('MediaContentType0') || '')

    if (numMedia > 0 && firstMediaUrl && isImageContentType(firstMediaType)) {
      try {
        await sendWhatsAppMessage(from, '🧘 Reading your note…')
        const imageReply = await readAndSummarizeImageNote({ mediaUrl: firstMediaUrl, contentType: firstMediaType, userCaption: bodyText })
        const savedNote = compactImageNoteForSaving(imageReply)
        await addToList(resolvedUser.telegramId, 'notes', [savedNote])
        await saveConversation(resolvedUser.telegramId, 'user', bodyText ? `[image] ${bodyText}` : '[image note]')
        await saveConversation(resolvedUser.telegramId, 'assistant', imageReply)
        await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText || '[image note]', reply: `${imageReply}\n\n✅ Saved to *my notes*.` })
      } catch (error: any) {
        console.error('WHATSAPP_IMAGE_NOTE_FAILED:', error?.message || error)
        await sendWhatsAppMessage(from, `I couldn’t read that image clearly.\n\nTry sending a clearer photo of the note, diary page, screenshot, or document.`)
      }
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    let incoming
    try { incoming = await getTextFromIncomingWhatsApp(formData) } catch (error: any) {
      console.error('WhatsApp voice transcription failed:', error)
      await sendWhatsAppMessage(from, `I couldn’t understand that voice note clearly.\n\nPlease try again with a shorter voice note, or type the message once.`)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    const originalText = incoming.text.trim()
    const text = incoming.wasVoice ? normalizeVoicePromptForBot(originalText) : originalText

    if (!text) {
      await sendWhatsAppMessage(from, `I can read text, voice notes, and images now.\n\nSend a short voice note, type your request, or upload a photo/screenshot of your notes.`)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isPaymentIntentCommand(text)) {
      const reply = await buildPaymentIntentReply({ telegramId: resolvedUser.telegramId, text, userName: resolvedUser.name })
      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      await sendWhatsAppMessage(from, incoming.wasVoice && incoming.voiceTranscript ? addVoicePrefix(reply, originalText) : reply)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isNotesCommand(text)) {
      const reply = await buildNotesReply(resolvedUser.telegramId, text)
      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      const finalReply = incoming.wasVoice && incoming.voiceTranscript ? addVoicePrefix(reply, originalText) : reply
      await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: text, reply: finalReply })
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    const referralResult = await recordReferralJoinFromText({ text, referredTelegramId: resolvedUser.telegramId, referredExternalId: from, referredName: profileName })

    if (isShareMyWinCommand(text)) {
      const reply = await buildShareMyWinReply(resolvedUser.telegramId)
      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      await sendWhatsAppMessage(from, incoming.wasVoice && incoming.voiceTranscript ? addVoicePrefix(reply, originalText) : reply)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isReferralCommand(text)) {
      const reply = await buildReferralUnlockReply(resolvedUser.telegramId)
      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      await sendWhatsAppMessage(from, incoming.wasVoice && incoming.voiceTranscript ? addVoicePrefix(reply, originalText) : reply)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    const referralWelcome = await buildReferralWelcomeNote(text)
    if (referralWelcome && referralResult?.saved) {
      await saveConversation(resolvedUser.telegramId, 'user', text)
      await saveConversation(resolvedUser.telegramId, 'assistant', referralWelcome)
      await sendWhatsAppMessage(from, referralWelcome)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isMemoryControlCommand(text)) {
      const reply = await buildMemoryControlReply(resolvedUser.telegramId, text)
      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      const finalReply = incoming.wasVoice && incoming.voiceTranscript ? addVoicePrefix(reply, originalText) : reply
      await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: text, reply: finalReply })
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (incoming.wasVoice) {
      const voiceLimit = await checkFeatureLimit(resolvedUser.telegramId, 'voice_note')
      if (!voiceLimit.allowed) {
        await sendWhatsAppMessage(from, voiceLimit.upgradeMessage || 'Voice note limit reached.')
        return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
      }
      await logUsage(resolvedUser.telegramId, 'voice_note', { transcript: originalText })
    }

    const directReply = getDirectWhatsappPremiumReply(text, resolvedUser.name)

    if (directReply) {
      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      if (directReply.saveMemory) await saveMemory(resolvedUser.telegramId, directReply.saveMemory)
      const finalReply = incoming.wasVoice && incoming.voiceTranscript ? addVoicePrefix(directReply.text, originalText) : directReply.text
      await saveConversation(resolvedUser.telegramId, 'assistant', finalReply)
      await sendWhatsAppMessage(from, finalReply)
      if (directReply.mediaUrl) {
        try { await sendWhatsAppMediaMessage(from, ' ', directReply.mediaUrl) } catch (mediaError: any) { console.error('WHATSAPP_PREMIUM_MEDIA_FAILED:', { mediaUrl: directReply.mediaUrl, error: mediaError?.message || mediaError }) }
      }
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    await sendThinkingIfNeeded(from, text)

    const result = await processIncomingMessage({ channel: 'whatsapp', externalUserId: from, text, userName: profileName, messageType: incoming.wasVoice ? 'voice' : 'text' })
    const finalReply = incoming.wasVoice && incoming.voiceTranscript ? addVoicePrefix(result.text, originalText) : result.text
    await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: text, reply: finalReply })

    return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
  } catch (error: any) {
    console.error('WhatsApp webhook error:', error)
    return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }
}
