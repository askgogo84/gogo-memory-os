import type { Channel } from './resolve-user'

function shortenCalendarOAuthLinks(text: string): string {
  return text.replace(
    /https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?[^\s]+/g,
    (rawUrl) => {
      try {
        const url = new URL(rawUrl)
        const redirectUri = url.searchParams.get('redirect_uri') || ''
        const state = url.searchParams.get('state') || ''

        // Only rewrite AskGogo's Google Calendar OAuth URL. Other Google links
        // must stay untouched.
        if (!redirectUri.includes('/api/calendar/callback') || !/^-?\d+$/.test(state)) {
          return rawUrl
        }

        return `https://app.askgogo.in/calendar?id=${encodeURIComponent(state)}`
      } catch {
        return rawUrl
      }
    }
  )
}

function cleanBaseText(text: string): string {
  return shortenCalendarOAuthLinks(text || '')
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
