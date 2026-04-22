import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'
import {
  deleteTelegramMessage,
  sendTelegramAnimation,
  sendTelegramChatAction,
  sendTelegramMessage,
} from '@/lib/channels/telegram'
import { downloadTelegramFile, transcribeVoice } from '@/lib/whisper'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { detectIntent } from '@/lib/bot/detect-intent'
import { getStatusText, shouldUseAnimation } from '@/lib/bot/status-message'

export const dynamic = 'force-dynamic'

const WORKING_GIF =
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3Bsa3I4b2g0b2U0bHc0b2w0aXQ5d2U3eWJ0cDV3cDZ3eTAzYyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3o7aCVpYB7JmA8jGHS/giphy.gif'

function getTelegramUserName(message: any): string {
  return (
    message?.from?.first_name ||
    message?.from?.username ||
    message?.chat?.first_name ||
    'Friend'
  )
}

async function alreadyProcessed(updateId: number) {
  const { data } = await supabaseAdmin
    .from('processed_updates')
    .select('id')
    .eq('platform', 'telegram')
    .eq('update_id', String(updateId))
    .maybeSingle()

  return !!data
}

async function markProcessed(updateId: number) {
  await supabaseAdmin.from('processed_updates').insert({
    platform: 'telegram',
    update_id: String(updateId),
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const updateId = body?.update_id
    const message = body?.message || body?.edited_message

    if (!message?.chat?.id) {
      return NextResponse.json({ ok: true, skipped: 'no message' })
    }

    if (updateId && (await alreadyProcessed(updateId))) {
      return NextResponse.json({ ok: true, skipped: 'duplicate update' })
    }

    const chatId = Number(message.chat.id)
    const userName = getTelegramUserName(message)

    let inputText = ''
    let messageType: 'text' | 'voice' | 'image' | 'document' = 'text'

    if (typeof message.text === 'string' && message.text.trim()) {
      inputText = message.text.trim()
      messageType = 'text'
    } else if (message.voice?.file_id) {
      messageType = 'voice'
      await sendTelegramChatAction(chatId, 'record_voice')
      const fileBuffer = await downloadTelegramFile(message.voice.file_id)
      const transcript = await transcribeVoice(fileBuffer)
      inputText = transcript?.trim() || 'Voice note received'
    } else {
      await sendTelegramMessage(
        chatId,
        'I can handle text and voice right now. Image and document flows will be re-added in the next phase.'
      )
      return NextResponse.json({ ok: true, skipped: 'unsupported message type' })
    }

    const intent = detectIntent(inputText)
    const statusText = getStatusText(intent.type, messageType)

    let tempMessageId: number | null = null

    if (shouldUseAnimation(intent.type, messageType)) {
      try {
        const anim = await sendTelegramAnimation(chatId, WORKING_GIF, statusText)
        tempMessageId = anim?.result?.message_id ?? null
      } catch {
        const sent = await sendTelegramMessage(chatId, statusText)
        tempMessageId = sent?.result?.message_id ?? null
      }
    } else {
      const sent = await sendTelegramMessage(chatId, statusText)
      tempMessageId = sent?.result?.message_id ?? null
    }

    const result = await processIncomingMessage({
      channel: 'telegram',
      externalUserId: String(chatId),
      text: inputText,
      userName,
      messageType,
    })

    if (tempMessageId) {
      await deleteTelegramMessage(chatId, tempMessageId)
    }

    const outgoing =
      messageType === 'voice'
        ? `Heard you via voice note\n${result.text}`
        : result.text

    await sendTelegramMessage(chatId, outgoing)

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}

