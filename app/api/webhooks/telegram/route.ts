import { NextRequest, NextResponse } from 'next/server'

// Types for Telegram update
interface TelegramMessage {
  message_id: number
  from: { id: number; first_name: string; username?: string }
  chat: { id: number; type: string }
  text?: string
  voice?: { file_id: string; duration: number }
  date: number
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

// Send a message back to Telegram
async function sendMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN!
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const update: TelegramUpdate = await req.json()
    const message = update.message
    if (!message) return NextResponse.json({ ok: true })

    const chatId = message.chat.id
    const userId = message.from.id
    const name = message.from.first_name
    const text = message.text || ''

    console.log(`📩 [${userId}] ${name}: ${text}`)

    // Handle /start command
    if (text === '/start') {
      await sendMessage(chatId,
        `👋 Hey ${name}! I'm your AskGogo AI assistant.\n\n` +
        `I can help you:\n` +
        `• 🧠 Remember anything you tell me\n` +
        `• ⏰ Set smart reminders\n` +
        `• 💬 Answer questions with full context\n\n` +
        `Just talk to me naturally. Try: _"Remind me to call Bareen tomorrow at 9am"_`
      )
      return NextResponse.json({ ok: true })
    }

    // Echo for now — Phase 2 replaces this with Claude
    await sendMessage(chatId, `You said: ${text}\n\n_(AI coming in Phase 2!)_`)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ ok: true }) // Always return 200 to Telegram
  }
}