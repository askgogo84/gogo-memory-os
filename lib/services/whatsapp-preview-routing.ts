export type WhatsAppPreviewRoutingInput = {
  bodyText: string
  mediaType: string
  numMedia: number
  mediaUrl?: string | null
}

function urls(text: string) {
  return Array.from(String(text || '').matchAll(/https?:\/\/[^\s<>]+/gi)).map((m) => m[0].replace(/[),.;!?]+$/, ''))
}

function hostOf(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

const BOOKING_HOSTS = [
  'bmsurl.co',
  'bookmyshow.com',
  'in.bookmyshow.com',
  'district.in',
  'paytm.com',
  'insider.in',
]

export function isBookingOrEventLinkText(bodyText: string) {
  const text = String(bodyText || '')
  const lower = text.toLowerCase()
  const foundUrls = urls(text)
  const hosts = foundUrls.map(hostOf)
  if (hosts.some((host) => BOOKING_HOSTS.some((known) => host === known || host.endsWith(`.${known}`)))) return true
  return foundUrls.length > 0 && /\b(bookmyshow|booking details|movie tickets?|event tickets?|we(?:'|’)re watching|we are watching|cinema|theatre|showtime|ticket details|reservation details)\b/i.test(lower)
}

export function shouldTreatMediaAsLinkPreview(input: WhatsAppPreviewRoutingInput) {
  if (input.numMedia <= 0 || !input.mediaUrl) return false
  if (!String(input.mediaType || '').toLowerCase().startsWith('image/')) return false
  if (!urls(input.bodyText).length) return false

  // Strong deterministic case: known booking/event forwards such as BookMyShow.
  // WhatsApp/Twilio often attach a thumbnail as MediaUrl0; that thumbnail is NOT
  // a user-uploaded document and must never reach OCR/asset/passport analysis.
  if (isBookingOrEventLinkText(input.bodyText)) return true

  // Conservative generic link-card detection. Require both a URL and card-like text;
  // ordinary user photos with a URL in the caption should continue as real images.
  const t = String(input.bodyText || '').trim()
  const cardLike = t.length < 700 && (
    /\bhttps?:\/\//i.test(t) &&
    (/\b(booking|details|watch|read|article|news|website|official|tickets?|event|offer)\b/i.test(t) || /\s[-|:]\s/.test(t))
  )
  return cardLike
}
