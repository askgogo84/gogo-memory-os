import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'
import {
  deleteTelegramMessage,
  sendTelegramAnimation,
  sendTelegramChatAction,
  sendTelegramMessage,
} from '@/lib/channels/telegram'
import { downloadTelegramFile, transcribeVoice } from '@/lib/whisper'
import { detectIntent } from '@/lib/bot/detect-intent'
import { getStatusText, shouldUseAnimation } from '@/lib/bot/status-message'

export const dynamic = 'force-dynamic'

const PREMIUM_LOADING_GIF =
  'https://media.giphy.com/media/xTkcEQACH24SMPxIQg/giphy.gif'

function getTelegramUserName(message: any): string {
  return (
    message?.from?.first_name ||
    message?.from?.username ||
    message?.chat?.first_name ||
    'Friend'
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const message = body?.message || body?.edited_message

    if (!message?.chat?.id) {
      return NextResponse.json({ ok: true, skipped: 'no message' })
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
        const anim = await sendTelegramAnimation(chatId, PREMIUM_LOADING_GIF, statusText)
        tempMessageId = anim?.result?.message_id ?? null
      } catch {
        try {
          const sent = await sendTelegramMessage(chatId, statusText)
          tempMessageId = sent?.result?.message_id ?? null
        } catch {
          tempMessageId = null
        }
      }
    }

    const result = await processIncomingMessage({
      channel: 'telegram',
      externalUserId: String(chatId),
      text: inputText,
      userName,
      messageType,
    })

    if (tempMessageId) {
      try {
        await deleteTelegramMessage(chatId, tempMessageId)
      } catch {
      }
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
      { status: 200 }
    )
  }
}
