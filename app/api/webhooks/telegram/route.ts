import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { sendTelegramChatAction, sendTelegramMessage } from '@/lib/channels/telegram'
import { downloadTelegramFile, transcribeVoice } from '@/lib/whisper'

export const dynamic = 'force-dynamic'

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

    const result = await processIncomingMessage({
      channel: 'telegram',
      externalUserId: String(chatId),
      text: inputText,
      userName,
      messageType,
    })

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
