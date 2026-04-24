import type { Channel } from './resolve-user'

function cleanBaseText(text: string): string {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/This message was sent automatically with n8n\.?/gi, '')
    .trim()
}

function formatForWhatsApp(text: string): string {
  let clean = cleanBaseText(text)

  // WhatsApp uses single *bold*
  clean = clean.replace(/\*\*/g, '*')

  // Keep replies premium and not too long
  if (clean.length > 3000) {
    clean = clean.slice(0, 2950).trim() + '\n\nReply “more” and I’ll continue.'
  }

  return clean
}

function formatForTelegram(text: string): string {
  let clean = cleanBaseText(text)

  if (clean.length > 4096) {
    clean = clean.slice(0, 4050).trim() + '\n\nReply “more” and I’ll continue.'
  }

  return clean
}

export function formatOutgoingText(channel: Channel, text: string): string {
  if (channel === 'whatsapp') return formatForWhatsApp(text)
  return formatForTelegram(text)
}
