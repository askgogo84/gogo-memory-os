export async function sendTelegramMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN!
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram send failed: ${body}`)
  }

  return response.json()
}

export async function sendTelegramAnimation(chatId: number, animationUrl: string, caption?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN!
  const response = await fetch(`https://api.telegram.org/bot${token}/sendAnimation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      animation: animationUrl,
      caption,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram animation failed: ${body}`)
  }

  return response.json()
}

export async function sendTelegramChatAction(
  chatId: number,
  action:
    | 'typing'
    | 'upload_photo'
    | 'record_video'
    | 'upload_video'
    | 'record_voice'
    | 'upload_voice'
    | 'upload_document'
    | 'choose_sticker'
    | 'find_location'
    | 'record_video_note'
    | 'upload_video_note'
) {
  const token = process.env.TELEGRAM_BOT_TOKEN!
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      action,
    }),
  })
}

export async function deleteTelegramMessage(chatId: number, messageId: number) {
  const token = process.env.TELEGRAM_BOT_TOKEN!
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
    }),
  })
}
