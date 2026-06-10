import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { sendWhatsAppMessage, sendWhatsAppMediaMessage, sendWhatsAppTyping } from '@/lib/channels/whatsapp'
import { resolveUser } from '@/lib/bot/resolve-user'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { addToList } from '@/lib/lists'
import { getDirectWhatsappPremiumReply } from '@/lib/bot/handlers/whatsapp-direct-premium'
import { normalizeVoicePromptForBot } from '@/lib/bot/handlers/voice-normalizer'
import { buildMemoryControlReply, isMemoryControlCommand } from '@/lib/bot/handlers/memory-control'
import { buildNotesReply, isNotesCommand, isMeetingNotesCommand, buildMeetingNotesListReply } from '@/lib/bot/handlers/notes-control'
import { buildPaymentIntentReply, isPaymentIntentCommand } from '@/lib/bot/handlers/payment-intent'
import { buildAdminWhatsAppReply, isAdminCommand, isAdminPhone } from '@/lib/bot/handlers/admin-analytics'
import { buildFirstValueReferralNudge } from '@/lib/bot/handlers/first-value-nudge'
import { getLatestFollowupState } from '@/lib/bot/handlers/followup-state'
import {
  buildSaveLastContextReply,
  isSaveLastContextCommand,
} from '@/lib/bot/handlers/save-last-context'
import {
  buildMeetingNotesReply,
  cleanTypedMeetingNotesText,
  isTypedMeetingNotesCommand,
  shouldTreatAudioAsMeeting,
} from '@/lib/bot/handlers/meeting-notes'
import {
  buildSkinCheckFromImage,
  buildSkinTextCommandReply,
  isSkinCheckCaption,
} from '@/lib/bot/handlers/skin-check'
import {
  buildReferralUnlockReply,
  buildReferralWelcomeNote,
  buildShareMyWinReply,
  isReferralCommand,
  isShareMyWinCommand,
  recordReferralJoinFromText,
} from '@/lib/bot/handlers/referral-unlock'
import { checkFeatureLimit, logUsage } from '@/lib/limits'
import { buildTimezoneCommandReply, inferTimezoneFromPhone, isTimezoneCommand } from '@/lib/bot/handlers/user-timezone'
import { routeFeatureIntent } from '@/lib/feature-intents'
import {
  isAudioContentType,
  transcribeTwilioVoiceNote,
} from '@/lib/services/voice-transcription'
import { isMeetingSearchCommand, buildMeetingSearchReply } from '@/lib/services/meeting-search'
import { buildOnboardingMenu, buildOnboardingFollowup, isOnboardingMenuReply } from '@/lib/bot/handlers/onboarding'
import { isNameReply, parseNameReply, relabelTranscript } from '@/lib/services/speaker-profiles'
import { isImageTranslationRequest, translateImage, buildImageTranslationReply, translateText, buildTranslationReply, parseTargetLanguage } from '@/lib/services/translator'
import { buildFollowupReminderMessage } from '@/lib/services/followup-reminder'
import { transcribeMeeting } from '@/lib/services/meeting-transcription'
import {
  compactImageNoteForSaving,
  isImageContentType,
  readAndSummarizeImageNote,
} from '@/lib/services/image-note-reader'
import { isInstagramReelPreview, detectReelUrl, detectInstagramPreviewCard, detectLinkedInPreviewCard } from '@/lib/services/reel-saver'
import { saveMediaMemory, isMediaMemoryCommand, buildMediaMemoryReply, detectPlatformFromText } from '@/lib/services/media-memory'
import { parsePdfTicket, buildTicketReply, getReminderTime } from '@/lib/services/pdf-reader'
import { handleNutritionPhoto, isNutritionPhotoCaption, handleNutritionGoalSelection } from '@/lib/bot/handlers/nutrition'

// Detect WhatsApp link preview cards (any website shared as a card)
// These come as: Body = "Site Title | Site Name" + MediaUrl0 = thumbnail
function isLinkPreviewCard(bodyText: string, mediaType: string): boolean {
  if (!bodyText || !bodyText.trim()) return false
  if (!mediaType.includes('image')) return false
  const t = bodyText.trim()
  // Must look like a title, not a personal message
  // Link preview titles: short, contain | or -, title-case, no first-person
  const hasLinkTitlePattern = (
    t.includes(' | ') ||
    t.includes(' - ') ||
    t.includes(': ') ||
    /^[A-Z]/.test(t)
  )
  const looksPersonal = /^(i |hey|hi|hello|can you|please|what|how|when|where|why|remind|add|save|show|my |the |ok|yes|no |sure)/i.test(t)
  const isShortTitle = t.length < 200 && t.split(' ').length < 25
  return hasLinkTitlePattern && !looksPersonal && isShortTitle
}
import {
  buildReceiptSummary,
  extractReceiptGroupName,
  isSplitReceiptCaption,
  scanReceiptFromImage,
} from '@/lib/splitwise/receipt-reader'
import { addScannedReceiptToSplit, handleReceiptItemizeCommand, isReceiptItemizeCommand } from '@/lib/splitwise/receipt-itemizer'

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

function getReplyText(reply: any) {
  return typeof reply === 'string' ? reply : String(reply?.text || '')
}

function recentImageMarker(params: { mediaUrl: string; contentType: string }) {
  return `[image_media] ${JSON.stringify({
    mediaUrl: params.mediaUrl,
    contentType: params.contentType,
    createdAt: new Date().toISOString(),
  })}`
}

function pendingSkinCheckMarker() {
  return `[pending_skin_check] ${JSON.stringify({ createdAt: new Date().toISOString() })}`
}

function completedSkinCheckMarker() {
  return `[completed_skin_check] ${JSON.stringify({ createdAt: new Date().toISOString() })}`
}

async function savePendingSkinCheckRequest(telegramId: number) {
  await saveConversation(telegramId, 'user', pendingSkinCheckMarker())
}

async function clearPendingSkinCheckRequest(telegramId: number) {
  await saveConversation(telegramId, 'user', completedSkinCheckMarker())
}

async function getLatestSkinCheckState(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('content, created_at')
    .eq('telegram_id', telegramId)
    .eq('role', 'user')
    .or('content.like.[pending_skin_check]%,content.like.[completed_skin_check]%')
    .order('created_at', { ascending: false })
    .limit(1)

  return data?.[0] || null
}

async function getRecentPendingSkinCheckRequest(telegramId: number) {
  const latest = await getLatestSkinCheckState(telegramId)
  if (!latest?.content?.startsWith('[pending_skin_check]')) return false

  const createdAt = new Date(latest.created_at).getTime()
  const ageMinutes = (Date.now() - createdAt) / (1000 * 60)
  return ageMinutes <= 20
}

async function saveRecentImageContext(params: {
  telegramId: number
  mediaUrl: string
  contentType: string
}) {
  await saveConversation(
    params.telegramId,
    'user',
    recentImageMarker({ mediaUrl: params.mediaUrl, contentType: params.contentType })
  )
}

async function createReminder(params: { telegramId: number; message: string; remindAtIso: string; whatsappTo?: string | null }) {
  const payload: any = { telegram_id: params.telegramId, chat_id: params.telegramId, message: params.message, remind_at: params.remindAtIso, sent: false }
  if (params.whatsappTo) payload.whatsapp_to = params.whatsappTo
  await supabaseAdmin.from('reminders').insert(payload)
}

async function createMeetingActionReminders(params: { telegramId: number; whatsappTo: string | null }) {
  const latest = await getLatestFollowupState(params.telegramId, 'meeting_action_items')
  const items = latest?.payload?.items || []
  if (!items.length) return null

  for (const item of items.slice(0, 5)) {
    if (!item?.message || !item?.remindAtIso) continue
    await createReminder({ telegramId: params.telegramId, message: item.message, remindAtIso: item.remindAtIso, whatsappTo: params.whatsappTo })
  }

  return (
    `OK - Meeting action reminders created\n\n` +
    items.slice(0, 5).map((item: any, index: number) => `${index + 1}. ${item.message}`).join('\n') +
    `\n\nI'll remind you tomorrow through the day.`
  )
}

async function sendWithFirstValueNudge(params: { from: string; telegramId: number; userText: string; reply: string }) {
  const nudge = await buildFirstValueReferralNudge({ telegramId: params.telegramId, userText: params.userText, botReply: params.reply })
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
  return `Voice note heard:\n"${cleanTranscript}"\n\n${reply}`
}

function shouldSendThinkingMedia(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return lower === 'today' || lower === 'morning briefing' || lower === 'today briefing' || lower === 'today summary' || lower.includes('show my unread') || lower.includes('unread emails') || lower.includes('latest emails') || lower.includes('latest mail') || lower.includes('reply to latest') || lower.includes('reply to the latest') || lower.includes('summarize my emails') || lower.includes('summarize my mails') || lower.includes('plan my day') || lower.includes('help me plan')
}

async function sendThinkingIfNeeded(from: string, text: string) {
  if (!shouldSendThinkingMedia(text)) return
  try { await sendWhatsAppMessage(from, 'Working on it...') } catch (error: any) { console.error('WHATSAPP_THINKING_TEXT_FAILED:', { error: error?.message || error }) }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(challenge || 'OK', { status: 200 })
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

    console.log('RAW_TWILIO:', Object.fromEntries([...formData.entries()]))
    console.log('WhatsApp inbound:', { fromRaw, from, profileName, numMedia, messageSid: inboundMessageSid, body: String(formData.get('Body') || ''), mediaType: String(formData.get('MediaContentType0') || ''), allKeys: [...formData.keys()].join(',') })
    if (!from) return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    if (inboundMessageSid) sendWhatsAppTyping(inboundMessageSid).catch((error: any) => console.error('WHATSAPP_TYPING_BACKGROUND_FAILED:', error?.message || error))

    const resolvedUser = await resolveUser({ channel: 'whatsapp', externalUserId: from, userName: profileName })
    const bodyText = String(formData.get('Body') || '').trim()

    // ── Interactive onboarding menu for new users ───────────────────
    if ((resolvedUser as any).isNewUser) {
      const welcomeMenu = buildOnboardingMenu(resolvedUser.name || profileName)
      await sendWhatsAppMessage(from, welcomeMenu)
      await saveConversation(resolvedUser.telegramId, 'assistant', welcomeMenu)
      // Don't return — continue processing their first message too
    }

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

    // Instagram/LinkedIn video cards come as video/mp4 — handle them FIRST before image branch
    const isVideoMedia = firstMediaType.startsWith('video/')
    if (numMedia > 0 && firstMediaUrl && isVideoMedia) {
      // Check if this is a social media link preview card (not a user-sent video)
      const isLinkedInCard = detectLinkedInPreviewCard(bodyText)
      const isIGCard = detectInstagramPreviewCard(bodyText) || isLinkPreviewCard(bodyText, 'image/jpeg')
      if (isIGCard || isLinkedInCard) {
        const detectedUrl = detectReelUrl(bodyText) || undefined
        const platform = detectPlatformFromText(bodyText, detectedUrl)
        const platformLabels: Record<string, string> = {
          instagram: '📸 Saving to Instagram memory...',
          facebook: '👥 Saving to Facebook memory...',
          youtube: '▶️ Saving YouTube video...',
          linkedin: '💼 Saving to LinkedIn memory...',
          twitter: '🐦 Saving to Twitter memory...',
          tiktok: '🎵 Saving TikTok...',
          other: '🔗 Saving content...',
        }
        await sendWhatsAppMessage(from, platformLabels[platform] || '💾 Saving...')
        const { reply: mediaReply } = await saveMediaMemory({
          telegramId: resolvedUser.telegramId,
          platform,
          bodyText,
          detectedUrl,
        })
        await saveConversation(resolvedUser.telegramId, 'user', `[${platform}] ${bodyText}`.trim())
        await saveConversation(resolvedUser.telegramId, 'assistant', mediaReply)
        await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText || `[${platform}]`, reply: mediaReply })
        return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
      }
      // Real user-sent video — fall through to Claude
    }

    if (numMedia > 0 && firstMediaUrl && isImageContentType(firstMediaType)) {
      try {
        await saveRecentImageContext({ telegramId: resolvedUser.telegramId, mediaUrl: firstMediaUrl, contentType: firstMediaType })
        const hasPendingSkinCheck = await getRecentPendingSkinCheckRequest(resolvedUser.telegramId)

        // ── Image translation (menus, signs, foreign documents) ────────────
        // Also auto-detect if caption contains foreign script characters
        const hasForeignScript = /[ऀ-ॿ؀-ۿ一-鿿぀-ゟ゠-ヿ가-힯฀-๿]/.test(bodyText)
        if (isImageTranslationRequest(bodyText) || hasForeignScript) {
          await sendWhatsAppMessage(from, '🌐 Translating image...')
          const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
          const imgRes = await fetch(firstMediaUrl, { headers: { Authorization: `Basic ${auth}` } })
          if (imgRes.ok) {
            const imgBuf = await imgRes.arrayBuffer()
            const imageBase64 = Buffer.from(imgBuf).toString('base64')
            const targetLang = parseTargetLanguage(bodyText)
            const isMenu = /menu|food|restaurant|cafe/i.test(bodyText)
            const translation = await translateImage({
              imageBase64,
              mediaType: firstMediaType || 'image/jpeg',
              caption: bodyText,
              targetLanguage: targetLang,
            })
            const reply = buildImageTranslationReply(translation, isMenu)
            await saveConversation(resolvedUser.telegramId, 'user', `[image translation] ${bodyText}`)
            await saveConversation(resolvedUser.telegramId, 'assistant', reply)
            await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText, reply })
          }
        } else if (isSplitReceiptCaption(bodyText)) {
          await sendWhatsAppMessage(from, 'Scanning receipt for AskGogo Split...')
          const receipt = await scanReceiptFromImage({ mediaUrl: firstMediaUrl, contentType: firstMediaType, userCaption: bodyText })
          const groupName = extractReceiptGroupName(bodyText)
          const saved = await addScannedReceiptToSplit({ ownerPhone: from, groupName, receipt, rawCaption: bodyText })
          const reply = `${buildReceiptSummary(receipt)}\n\n${saved.reply}\n\nNext: send *itemize receipt Rahul had pizza, Priya had pasta* to assign items to people.`
          await saveConversation(resolvedUser.telegramId, 'user', `[split receipt image] ${bodyText}`.trim())
          await saveConversation(resolvedUser.telegramId, 'assistant', reply)
          await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText || '[split receipt image]', reply })
        } else if (isNutritionPhotoCaption(bodyText) || (!bodyText.trim() && !isSkinCheckCaption(bodyText) && !hasPendingSkinCheck)) {
          // ── Food photo → first verify it's actually food via quick vision check ──
          let isFoodImage = true
          try {
            const Anthropic = (await import('@anthropic-ai/sdk')).default
            const ant = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
            const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
            const imgRes = await fetch(firstMediaUrl, { headers: { Authorization: `Basic ${auth}` } })
            if (imgRes.ok) {
              const imgBuf = await imgRes.arrayBuffer()
              const b64 = Buffer.from(imgBuf).toString('base64')
              const check = await ant.messages.create({
                model: 'claude-haiku-4-5', max_tokens: 10,
                messages: [{ role: 'user', content: [
                  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                  { type: 'text', text: 'Does this image contain food or a meal? Reply only: YES or NO' }
                ]}]
              })
              const ans = check.content[0]?.type === 'text' ? check.content[0].text.trim() : 'NO'
              // Check for foreign text in response or direct YES/NO
              const upperAns = ans.toUpperCase()
              isFoodImage = upperAns.includes('YES') && !upperAns.includes('FOREIGN') && !upperAns.includes('JAPANESE') && !upperAns.includes('CHINESE') && !upperAns.includes('ARABIC')
            }
          } catch { isFoodImage = false } // default to image note on error — better safe than wrong

          if (!isFoodImage) {
            // Not food — treat as image note instead
            await sendWhatsAppMessage(from, '📝 Saving as a note...')
            const { readAndSummarizeImageNote } = await import('@/lib/services/image-note-reader')
            const noteReply = await readAndSummarizeImageNote({ mediaUrl: firstMediaUrl, contentType: firstMediaType, userCaption: bodyText })
            await saveConversation(resolvedUser.telegramId, 'user', bodyText ? `[image] ${bodyText}` : '[image]')
            await saveConversation(resolvedUser.telegramId, 'assistant', noteReply)
            await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText || '[image]', reply: noteReply })
          } else {
          await sendWhatsAppMessage(from, '🥗 Analysing your meal...')
          const nutritionReply = await handleNutritionPhoto({
            telegramId: resolvedUser.telegramId,
            mediaUrl: firstMediaUrl,
            contentType: firstMediaType,
            caption: bodyText
          })
          await saveConversation(resolvedUser.telegramId, 'user', bodyText ? `[food photo] ${bodyText}` : '[food photo]')
          await saveConversation(resolvedUser.telegramId, 'assistant', nutritionReply)
          await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText || '[food photo]', reply: nutritionReply })
          } // end isFoodImage
        } else if (isSkinCheckCaption(bodyText) || hasPendingSkinCheck) {
          await sendWhatsAppMessage(from, 'Running AskGogo Skin Check...')
          const result = await buildSkinCheckFromImage({
            telegramId: resolvedUser.telegramId,
            mediaUrl: firstMediaUrl,
            contentType: firstMediaType,
            userCaption: bodyText || 'skin check',
            userName: resolvedUser.name || profileName,
          })
          await clearPendingSkinCheckRequest(resolvedUser.telegramId)
          await saveConversation(resolvedUser.telegramId, 'user', `[skin check image] ${bodyText || 'skin check'}`.trim())
          await saveConversation(resolvedUser.telegramId, 'assistant', result.report)
          await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText || '[skin check image]', reply: result.reply })
        } else if (isNameReply(bodyText)) {
          // Check if there's a pending speaker relabel state (within last 10 mins)
          const speakerState = await getLatestFollowupState(resolvedUser.telegramId, 'meeting_speaker_relabel')
          const stateAge = speakerState?.payload?.created_at
            ? Date.now() - new Date(speakerState.payload.created_at).getTime()
            : Infinity
          if (stateAge < 10 * 60 * 1000 && speakerState?.payload?.transcript && speakerState?.payload?.speakerCount > 1) {
            const names = parseNameReply(bodyText)
            const namedTranscript = relabelTranscript(speakerState.payload.transcript, names)
            const nameLabels = names.map((n: string, i: number) => `Speaker ${'ABCDEF'[i]} → *${n}*`).join('\n')
            const reply = (
              `✅ *Names saved!*\n\n${nameLabels}\n\n` +
              `📝 *Named transcript:*\n\n${namedTranscript.slice(0, 3500)}` +
              (namedTranscript.length > 3500 ? '\n_...say *my meeting notes* to see full notes_' : '')
            )
            await saveConversation(resolvedUser.telegramId, 'user', bodyText)
            await saveConversation(resolvedUser.telegramId, 'assistant', reply)
            await sendWhatsAppMessage(from, reply)
            return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
          }
          // Not a speaker reply — fall through to normal AI handling below
        } else if (isInstagramReelPreview(bodyText) || isLinkPreviewCard(bodyText, firstMediaType) || (detectReelUrl(bodyText) !== null && numMedia > 0)) {
          // ── Social media content (Instagram, LinkedIn, Facebook, YouTube, Twitter) ──
          // Detect platform and save to the right memory bucket
          const detectedUrl = detectReelUrl(bodyText) || undefined
          const platform = detectPlatformFromText(bodyText, detectedUrl)
          const platformLabels: Record<string, string> = {
            instagram: '📸 Saving to Instagram memory...',
            facebook: '👥 Saving to Facebook memory...',
            youtube: '▶️ Saving YouTube video...',
            linkedin: '💼 Saving to LinkedIn memory...',
            twitter: '🐦 Saving to Twitter memory...',
            tiktok: '🎵 Saving TikTok...',
            other: '🔗 Saving content...',
          }
          await sendWhatsAppMessage(from, platformLabels[platform] || '💾 Saving...')
          const { reply: mediaReply } = await saveMediaMemory({
            telegramId: resolvedUser.telegramId,
            platform,
            bodyText,
            mediaUrl: firstMediaUrl || undefined,
            accountSid: process.env.TWILIO_ACCOUNT_SID || undefined,
            authToken: process.env.TWILIO_AUTH_TOKEN || undefined,
            detectedUrl,
          })
          await saveConversation(resolvedUser.telegramId, 'user', `[${platform}] ${bodyText}`.trim())
          await saveConversation(resolvedUser.telegramId, 'assistant', mediaReply)
          await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText || `[${platform}]`, reply: mediaReply })
        } else {
          await sendWhatsAppMessage(from, 'Reading your note...')
          const imageReply = await readAndSummarizeImageNote({
            mediaUrl: firstMediaUrl,
            contentType: firstMediaType,
            userCaption: bodyText,
            expectedPatientName: resolvedUser.name || profileName,
          })
          const savedNote = compactImageNoteForSaving(imageReply)
          await addToList(resolvedUser.telegramId, 'notes', [savedNote])
          await saveConversation(resolvedUser.telegramId, 'user', bodyText ? `[image] ${bodyText}` : '[image note]')
          await saveConversation(resolvedUser.telegramId, 'assistant', imageReply)
          await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText || '[image note]', reply: `${imageReply}\n\nSaved to *my notes*.` })
        }
      } catch (error: any) {
        console.error('WHATSAPP_IMAGE_PROCESSING_FAILED:', error?.message || error)
        await sendWhatsAppMessage(from, `I couldn't read that image clearly.\n\nFor split receipts, send a clear bill photo with caption: *split receipt Goa Test*.\nFor skin check, send a clear front-facing selfie with caption: *skin check*.\nFor notes, send a clearer photo of the note, diary page, screenshot, or document.`)
      }
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    // ── PDF / Document handler (BEFORE voice transcription) ──────────────
    if (numMedia > 0 && firstMediaUrl && (firstMediaType.includes('pdf') || firstMediaType.includes('document'))) {
      await sendWhatsAppMessage(from, '📄 Reading your ticket PDF...')
      try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID!
        const authToken = process.env.TWILIO_AUTH_TOKEN!
        const ticketInfo = await parsePdfTicket(firstMediaUrl, accountSid, authToken)
        const noteText = ticketInfo
          ? `PDF ticket: ${JSON.stringify(ticketInfo).slice(0, 200)}`
          : `PDF document: ${bodyText || 'received'}`
        await addToList(resolvedUser.telegramId, 'notes', [noteText])
        let remindersSet = 0
        if (ticketInfo?.type === 'flight') {
          for (const flight of (ticketInfo as any).flights) {
            const reminderTime = getReminderTime(flight.date, flight.departure)
            if (reminderTime && reminderTime > new Date()) {
              const reminderMsg = `✈️ ${flight.from} → ${flight.to} departs in 3 hours at ${flight.departure}! PNR: ${flight.pnr}`
              await supabaseAdmin.from('reminders').insert({ telegram_id: resolvedUser.telegramId, whatsapp_id: from, message: reminderMsg, remind_at: reminderTime.toISOString(), created_at: new Date().toISOString() })
              remindersSet++
            }
          }
        } else if (ticketInfo?.type === 'train' || ticketInfo?.type === 'event') {
          const t = ticketInfo as any
          const reminderTime = getReminderTime(t.date, t.departure || t.time)
          if (reminderTime && reminderTime > new Date()) {
            const name = t.type === 'train' ? `${t.from} → ${t.to}` : t.name
            await supabaseAdmin.from('reminders').insert({ telegram_id: resolvedUser.telegramId, whatsapp_id: from, message: `${t.type === 'train' ? '🚆' : '🎟️'} ${name} starts in 3 hours at ${t.departure || t.time}!`, remind_at: reminderTime.toISOString(), created_at: new Date().toISOString() })
            remindersSet++
          }
        }
        const reply = buildTicketReply(ticketInfo, remindersSet > 0)
        await saveConversation(resolvedUser.telegramId, 'user', '[PDF ticket]')
        await saveConversation(resolvedUser.telegramId, 'assistant', reply)
        await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: '[PDF ticket]', reply })
      } catch (err: any) {
        console.error('PDF_PARSE_ERROR:', err?.message)
        await sendWhatsAppMessage(from, `📄 I received your PDF but had trouble reading it.

Tell me the details and I'll save + set reminders:
_"Bengaluru to Varanasi flight on 2 July at 2:50pm"_`)
      }
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    let incoming
    try { incoming = await getTextFromIncomingWhatsApp(formData) } catch (error: any) {
      console.error('WhatsApp voice transcription failed:', error)
      await sendWhatsAppMessage(from, `I couldn't understand that voice note clearly.\n\nPlease try again with a shorter voice note, or type the message once.`)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    const originalText = incoming.text.trim()
    const text = incoming.wasVoice ? normalizeVoicePromptForBot(originalText) : originalText

    if (!text) {
      await sendWhatsAppMessage(from, `I can read text, voice notes, images and PDFs now.\n\nFor Split Receipt, send a clear bill photo with caption: *split receipt Goa Test*.\nFor Skin Check, send a clear selfie with caption: *skin check*.`)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isReceiptItemizeCommand(text)) {
      const reply = await handleReceiptItemizeCommand(from, text)
      if (reply) {
        await saveConversation(resolvedUser.telegramId, 'user', text)
        await saveConversation(resolvedUser.telegramId, 'assistant', reply)
        await sendWhatsAppMessage(from, reply)
        return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
      }
    }

    // Check context: if last bot msg was nutrition goal menu, digits go to nutrition not skin
    const isAmbiguousDigit = /^[1-5]$/.test(text.trim())
    let skinTextReply = null
    if (isAmbiguousDigit) {
      const { data: lastBotMsg } = await supabaseAdmin
        .from('conversations')
        .select('content')
        .eq('telegram_id', resolvedUser.telegramId)
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      const lastContent = (lastBotMsg?.content || '').toLowerCase()
      const isNutritionContext = lastContent.includes('nutrition goal') || lastContent.includes('working towards') ||
        lastContent.includes('lose weight') || lastContent.includes('build muscle') ||
        lastContent.includes('balanced & healthy') || lastContent.includes('maintenance') ||
        lastContent.includes('calorie deficit') || lastContent.includes('calorie surplus')
      if (isNutritionContext) {
        const nutritionReply = await handleNutritionGoalSelection(resolvedUser.telegramId, text)
        await saveConversation(resolvedUser.telegramId, 'user', text)
        await saveConversation(resolvedUser.telegramId, 'assistant', nutritionReply)
        await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: text, reply: nutritionReply })
      } else {
        skinTextReply = await buildSkinTextCommandReply({ telegramId: resolvedUser.telegramId, text })
      }
    } else {
      skinTextReply = await buildSkinTextCommandReply({ telegramId: resolvedUser.telegramId, text })
    }
    if (skinTextReply) {
      const replyText = getReplyText(skinTextReply)
      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      await saveConversation(resolvedUser.telegramId, 'assistant', replyText)
      if (typeof skinTextReply === 'object' && skinTextReply.mediaUrl) {
        await sendWhatsAppMessage(from, replyText)
        try {
          await sendWhatsAppMediaMessage(from, 'Skin Report Card', skinTextReply.mediaUrl)
        } catch (mediaError: any) {
          console.error('WHATSAPP_SKIN_REPORT_CARD_MEDIA_FAILED:', {
            mediaUrl: skinTextReply.mediaUrl,
            error: mediaError?.message || mediaError,
          })
        }
      } else {
        await sendWhatsAppMessage(from, replyText)
      }
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isSkinCheckCaption(text)) {
      await savePendingSkinCheckRequest(resolvedUser.telegramId)

      const reply = `*AskGogo Skin Check*\n\nPlease upload a fresh selfie now. I'll run Skin Check on the new photo only.\n\nFor best results:\n- natural light\n- no heavy filter\n- face visible clearly\n- no medical diagnosis - skincare observation only`

      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      await sendWhatsAppMessage(from, reply)

      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isSaveLastContextCommand(text)) {
      const reply = await buildSaveLastContextReply({ telegramId: resolvedUser.telegramId, text })
      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: text, reply })
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    const yesFollowup = /^(yes|yeah|yep|haan|ok|okay|create reminders|add reminders)( .*)?$/i.test(text)
    if (yesFollowup) {
      const meetingReminderReply = await createMeetingActionReminders({ telegramId: resolvedUser.telegramId, whatsappTo: from })
      if (meetingReminderReply) {
        await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
        await saveConversation(resolvedUser.telegramId, 'assistant', meetingReminderReply)
        await sendWhatsAppMessage(from, meetingReminderReply)
        return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
      }
    }

    if (!incoming.wasVoice && isTypedMeetingNotesCommand(text)) {
      try {
        await sendWhatsAppMessage(from, 'Preparing meeting notes...')
        const transcript = cleanTypedMeetingNotesText(text)
        const { summaryReply } = await buildMeetingNotesReply({ telegramId: resolvedUser.telegramId, transcript, caption: 'Typed meeting notes' })
        const reply = summaryReply
        await saveConversation(resolvedUser.telegramId, 'user', `[typed meeting notes] ${transcript.slice(0, 500)}`)
        await saveConversation(resolvedUser.telegramId, 'assistant', reply)
        await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: text, reply })
      } catch (error: any) {
        console.error('WHATSAPP_TYPED_MEETING_NOTES_FAILED:', error?.message || error)
        await sendWhatsAppMessage(from, `I couldn't turn that into meeting notes.\n\nTry starting with: *Meeting notes:* followed by the discussion and action items.`)
      }
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    // ── Voice translation (voice note + caption "translate" or "translate to Hindi") ──
    if (incoming.wasVoice && /^translate/i.test(bodyText.trim())) {
      const targetLang = parseTargetLanguage(bodyText)
      await sendWhatsAppMessage(from, `🌐 Translating to ${targetLang}...`)
      const result = await translateText({ text: originalText, targetLanguage: targetLang })
      const reply = (
        `🎤 *Voice note heard:*
_"${originalText}"_

` +
        buildTranslationReply({ ...result, originalText })
      )
      await saveConversation(resolvedUser.telegramId, 'user', `[voice translate] ${originalText}`)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: originalText, reply })
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (incoming.wasVoice && shouldTreatAudioAsMeeting({ caption: bodyText, transcript: originalText })) {
      try {
        await sendWhatsAppMessage(from, '🎙️ Transcribing your meeting...\n_Speaker detection + multilingual support enabled_')

        // Re-fetch audio for AssemblyAI speaker diarization
        const mediaUrl0 = String(formData.get('MediaUrl0') || '')
        const contentType0 = String(formData.get('MediaContentType0') || 'audio/ogg')
        let txResult = null

        if (mediaUrl0) {
          const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
          const audioRes = await fetch(mediaUrl0, { headers: { Authorization: `Basic ${auth}` } })
          if (audioRes.ok) {
            const audioBuffer = await audioRes.arrayBuffer()
            txResult = await transcribeMeeting({ audioBuffer, contentType: contentType0, isMeeting: true })
          }
        }

        const { summaryReply, transcriptChunks, speakerPrompt } = await buildMeetingNotesReply({
          telegramId: resolvedUser.telegramId,
          transcript: originalText,
          speakerTranscript: txResult?.formattedWithSpeakers,
          detectedLanguage: txResult?.detectedLanguage,
          speakerCount: txResult?.speakerCount,
          caption: bodyText,
        })

        await saveConversation(resolvedUser.telegramId, 'user', `[meeting audio] ${bodyText || originalText.slice(0, 300)}`)
        await saveConversation(resolvedUser.telegramId, 'assistant', summaryReply)

        // Send summary first
        await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: bodyText || '[meeting audio]', reply: summaryReply })

        // Then send full transcript as separate message(s)
        for (const chunk of transcriptChunks) {
          await sendWhatsAppMessage(from, chunk)
        }

        // Ask for speaker names if multiple speakers detected
        if (speakerPrompt) {
          await new Promise(r => setTimeout(r, 1500)) // brief pause before asking
          await sendWhatsAppMessage(from, speakerPrompt)
        }
      } catch (error: any) {
        console.error('WHATSAPP_MEETING_NOTES_FAILED:', error?.message || error)
        await sendWhatsAppMessage(from, `I couldn't summarize that meeting audio clearly.\n\nTry a shorter recording, or add caption: *meeting notes* when sending the audio.`)
      }
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    const featureReply = await routeFeatureIntent(from, text, { telegramId: resolvedUser.telegramId, caption: bodyText }) ||
      (incoming.wasVoice && originalText !== text ? await routeFeatureIntent(from, originalText, { telegramId: resolvedUser.telegramId }) : null)
    if (featureReply) {
      await saveConversation(resolvedUser.telegramId, 'user', text)
      await saveConversation(resolvedUser.telegramId, 'assistant', featureReply)
      await sendWhatsAppMessage(from, featureReply)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isPaymentIntentCommand(text)) {
      const reply = await buildPaymentIntentReply({ telegramId: resolvedUser.telegramId, text, userName: resolvedUser.name })
      await saveConversation(resolvedUser.telegramId, 'user', incoming.wasVoice ? `[voice] ${originalText} -> ${text}` : text)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      await sendWhatsAppMessage(from, incoming.wasVoice && incoming.voiceTranscript ? addVoicePrefix(reply, originalText) : reply)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    // ── Follow-up reminder done/snooze handler ────────────────────────────────
    const isDone = /^(done|resolved|sorted|closed|completed|cancel reminder|no need)$/i.test(text.trim())
    const snoozeMatch = text.trim().match(/^snooze\s+(.+)$/i)

    if (isDone || snoozeMatch) {
      // Find most recently fired reminder (sent in last 30 mins) OR any pending reminder
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      const { data: recentFired } = await supabaseAdmin
        .from('reminders')
        .select('id, message, recurring_pattern')
        .eq('telegram_id', resolvedUser.telegramId)
        .eq('sent', true)
        .gte('updated_at', thirtyMinsAgo)
        .order('updated_at', { ascending: false })
        .limit(1)

      const { data: pendingFollowupsRaw } = await supabaseAdmin
        .from('reminders')
        .select('id, message, recurring_pattern')
        .eq('telegram_id', resolvedUser.telegramId)
        .eq('sent', false)
        .order('remind_at', { ascending: true })
        .limit(1)

      // Prefer the most recently fired reminder for snooze
      const pendingFollowups = recentFired?.length ? recentFired : pendingFollowupsRaw

      if (pendingFollowups?.length) {
        const r = pendingFollowups[0]
        if (isDone) {
          // Mark as sent (cancel it)
          await supabaseAdmin.from('reminders').update({ sent: true }).eq('id', r.id)
          const reply = `✅ Got it! *${r.message}* marked as resolved.

_Reminder cancelled._`
          await saveConversation(resolvedUser.telegramId, 'user', text)
          await saveConversation(resolvedUser.telegramId, 'assistant', reply)
          await sendWhatsAppMessage(from, reply)
          return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
        } else if (snoozeMatch) {
          // Parse snooze duration
          const snoozeText = snoozeMatch[1].trim()
          const minsMatch = snoozeText.match(/(\d+)\s*(min|mins|minute|minutes)/i)
          const hoursMatch = snoozeText.match(/(\d+)\s*(hour|hours|hr|hrs)/i)
          const daysMatch = snoozeText.match(/(\d+)\s*(day|days)/i)
          const weekdayMap: Record<string, number> = { monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0 }
          let snoozeMs = 24 * 60 * 60 * 1000 // default 1 day
          let snoozeLabel = 'tomorrow'
          if (minsMatch) {
            const mins = parseInt(minsMatch[1])
            snoozeMs = mins * 60 * 1000
            snoozeLabel = `in ${mins} minutes`
          } else if (hoursMatch) {
            const hrs = parseInt(hoursMatch[1])
            snoozeMs = hrs * 60 * 60 * 1000
            snoozeLabel = `in ${hrs} hours`
          } else if (daysMatch) {
            const days = parseInt(daysMatch[1])
            snoozeMs = days * 24 * 60 * 60 * 1000
            snoozeLabel = days === 1 ? 'tomorrow' : `in ${days} days`
          } else if (weekdayMap[snoozeText.toLowerCase()] !== undefined) {
            const target = weekdayMap[snoozeText.toLowerCase()]
            const today = new Date().getDay()
            const snoozeDays = ((target - today + 7) % 7) || 7
            snoozeMs = snoozeDays * 24 * 60 * 60 * 1000
            snoozeLabel = `on ${snoozeText}`
          }
          const newRemindAt = new Date(Date.now() + snoozeMs)
          // Only set to 9 AM if snoozing by days, not minutes/hours
          if (snoozeMs >= 24 * 60 * 60 * 1000) newRemindAt.setUTCHours(3, 30, 0, 0) // 9 AM IST
          await supabaseAdmin.from('reminders').update({ remind_at: newRemindAt.toISOString(), sent: false, updated_at: new Date().toISOString() }).eq('id', r.id)
          const reply = `⏰ Snoozed! I'll remind you about *${r.message}* again *${snoozeLabel}*.`
          await saveConversation(resolvedUser.telegramId, 'user', text)
          await saveConversation(resolvedUser.telegramId, 'assistant', reply)
          await sendWhatsAppMessage(from, reply)
          return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
        }
      }
    }

    // ── Onboarding menu reply (1-6) ────────────────────────────────────────
    const onboardingChoice = isOnboardingMenuReply(text)
    if (onboardingChoice) {
      const { data: recentConvs } = await supabaseAdmin
        .from('conversations')
        .select('role, content')
        .eq('telegram_id', resolvedUser.telegramId)
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(3)
      const lastBotOB = recentConvs?.[0]?.content || ''
      if (lastBotOB.includes('What do you need most?') || lastBotOB.includes('Welcome to AskGogo')) {
        const followup = buildOnboardingFollowup(onboardingChoice, resolvedUser.name || profileName)
        await saveConversation(resolvedUser.telegramId, 'user', text)
        await saveConversation(resolvedUser.telegramId, 'assistant', followup)
        await sendWhatsAppMessage(from, followup)
        return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
      }
    }

    // ── Admin/test: reset onboarding menu ───────────────────────────────────
    if (/^(reset onboarding|show onboarding|onboarding menu|test onboarding)$/i.test(text.trim())) {
      const menu = buildOnboardingMenu(resolvedUser.name || profileName)
      await saveConversation(resolvedUser.telegramId, 'assistant', menu)
      await sendWhatsAppMessage(from, menu)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isMeetingSearchCommand(text)) {
      await sendWhatsAppMessage(from, '🔍 Searching your meeting history...')
      const reply = await buildMeetingSearchReply(resolvedUser.telegramId, text)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      await sendWhatsAppMessage(from, reply)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    if (isMeetingNotesCommand(text)) {
      const reply = await buildMeetingNotesListReply(resolvedUser.telegramId)
      await sendWhatsAppMessage(from, reply)
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

    if (isTimezoneCommand(text)) {
      const reply = await buildTimezoneCommandReply({
        text,
        telegramId: resolvedUser.telegramId,
        currentTimeZone: resolvedUser.timezone || inferTimezoneFromPhone(from),
      })
      await sendWhatsAppMessage(from, reply)
      return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

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
    // Send visual card if process-message returned a mediaUrl
    if ((result as any).mediaUrl) {
      const caption = finalReply || '📊 Your nutrition card'
      await sendWhatsAppMediaMessage(from, caption, (result as any).mediaUrl)
    } else {
      await sendWithFirstValueNudge({ from, telegramId: resolvedUser.telegramId, userText: text, reply: finalReply })
    }

    return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
  } catch (error: any) {
    console.error('WhatsApp webhook error:', error)
    return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }
}


