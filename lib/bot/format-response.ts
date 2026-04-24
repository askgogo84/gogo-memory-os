import type { Channel } from './resolve-user'

function cleanBaseText(text: string): string {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatForWhatsApp(text: string): string {
  let clean = cleanBaseText(text)

  clean = clean.replace(/\*\*/g, '*')
  clean = clean.replace(/This message was sent automatically with n8n\.?/gi, '').trim()

  if (clean.length > 3200) {
    clean = clean.slice(0, 3150).trim() + '\n\nReply “more” if you want the rest.'
  }

  return clean
}

function formatForTelegram(text: string): string {
  const clean = cleanBaseText(text)

  if (clean.length > 4096) {
    return clean.slice(0, 4050).trim() + '\n\nReply “more” if you want the rest.'
  }

  return clean
}

export function formatOutgoingText(channel: Channel, text: string): string {
  if (channel === 'whatsapp') return formatForWhatsApp(text)
  return formatForTelegram(text)
}