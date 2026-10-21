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

// Round 6 (#22): "Where is my car parked?" came back ALL IN CAPITALS (the model copied a shouted memory). A reply
// that is mostly capitals is put back into sentence case; short codes and anything with digits (B2, 6E204, PVR, QR)
// keep their case. Pure.
const KEEP_CAPS = new Set(['PNR', 'PVR', 'QR', 'IST', 'OTP', 'UPI', 'GST', 'USD', 'INR', 'AED', 'ATM', 'EMI', 'KYC', 'PAN', 'IRCTC', 'BLR', 'DEL', 'BOM', 'MAA', 'HYD', 'CCU', 'AI', 'TV', 'AC', 'ID', 'UK', 'US', 'UAE', 'ISRO', 'IPL', 'SMS', 'URL', 'PDF', 'GB', 'TB'])
export function calmShouting(text: string): string {
  const letters: string[] = String(text || '').replace(/https?:\/\/\S+/g, '').match(/\p{L}/gu) || []
  const upper = letters.filter(c => c !== c.toLowerCase()).length
  if (letters.length <= 20 || upper / letters.length <= 0.7) return text
  return text
    .replace(/https?:\/\/\S+|\S+/g, tok => {
      if (/^https?:\/\//i.test(tok)) return tok
      const core = tok.replace(/[^\p{L}\p{N}]/gu, '')
      return /\d/.test(core) || KEEP_CAPS.has(core) ? tok : tok.toLowerCase()
    })
    .replace(/(^|[.!?]\s+|\n\s*(?:[*•-]\s*)?)(\p{Ll})/gu, (_m, lead, ch) => lead + ch.toUpperCase())
    .replace(/\bi\b/g, 'I')
}

// Round 6 (#7): a web answer kept a link whose address had been half-redacted ("…/[sensitive detail withheld]…").
// A link carrying the redaction marker is useless and looks broken: keep its words, drop the address. Pure.
const WITHHELD = /\[(?:sensitive |authentication )?detail withheld\]/i
export function dropRedactedLinks(text: string): string {
  if (!text || !/detail withheld\]/i.test(text)) return text
  return String(text)
    .replace(/\[([^\]]*?)\]\(([^)]*)\)/g, (m, label, href) => (!WITHHELD.test(href) && !WITHHELD.test(label) ? m : WITHHELD.test(label) ? '' : label))
    .replace(/(?:https?:\/\/|www\.)\S*?\[(?:sensitive |authentication )?detail withheld\]\S*/gi, '')
    .replace(/(^|\n)[ \t]*(?:Sources?|Links?):[ \t]*(?=\n|$)/gi, '$1')
    .replace(/[ \t]{2,}/g, ' ')
}

function cleanBaseText(text: string): string {
  return calmShouting(dropRedactedLinks(shortenCalendarOAuthLinks(text || ''))
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/This message was sent automatically with n8n\.?/gi, '')
    .trim())
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
