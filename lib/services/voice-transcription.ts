import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

function getExtension(contentType: string) {
  const type = (contentType || '').toLowerCase()

  if (type.includes('ogg')) return 'ogg'
  if (type.includes('mpeg')) return 'mp3'
  if (type.includes('mp3')) return 'mp3'
  if (type.includes('mp4')) return 'mp4'
  if (type.includes('m4a')) return 'm4a'
  if (type.includes('wav')) return 'wav'
  if (type.includes('webm')) return 'webm'

  return 'ogg'
}

export function isAudioContentType(contentType: string | null | undefined) {
  const type = (contentType || '').toLowerCase()
  return type.startsWith('audio/')
}

/**
 * Never attach Twilio Basic credentials to an inbound, caller-controlled media URL.
 * Restrict the first request to a media resource under the configured account.
 * This is hostname containment, not a replacement for network-level DNS pinning.
 */
export function trustedTwilioVoiceMediaUrl(raw: unknown, accountSid: string): string | null {
  if (typeof raw !== 'string' || !/^AC[a-f0-9]{32}$/i.test(accountSid)) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname !== 'api.twilio.com' ||
        url.username || url.password || url.port || url.search || url.hash) return null
    const path = new RegExp(
      `^/2010-04-01/Accounts/${accountSid}/Messages/(?:SM|MM)[a-f0-9]{32}/Media/ME[a-f0-9]{32}(?:/Content)?import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

function getExtension(contentType: string) {
  const type = (contentType || '').toLowerCase()

  if (type.includes('ogg')) return 'ogg'
  if (type.includes('mpeg')) return 'mp3'
  if (type.includes('mp3')) return 'mp3'
  if (type.includes('mp4')) return 'mp4'
  if (type.includes('m4a')) return 'm4a'
  if (type.includes('wav')) return 'wav'
  if (type.includes('webm')) return 'webm'

  return 'ogg'
}

export function isAudioContentType(contentType: string | null | undefined) {
  const type = (contentType || '').toLowerCase()
  return type.startsWith('audio/')
}

,
      'i',
    )
    return path.test(url.pathname) ? url.toString() : null
  } catch {
    return null
  }
}

/** Twilio's media CDN redirect is allowed only as one manual, unauthenticated hop. */
export function trustedTwilioVoiceCdnUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname !== 'mms.twiliocdn.com' ||
        url.username || url.password || url.port || url.hash ||
        !url.pathname || url.pathname === '/') return null
    return url.toString()
  } catch {
    return null
  }
}

const MAX_VOICE_NOTE_BYTES = 24 * 1024 * 1024

async function boundedVoiceAudio(response: Response): Promise<ArrayBuffer> {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_VOICE_NOTE_BYTES)) {
    throw new Error('Voice note is too large. Please send a shorter voice note.')
  }
  const stream = response.body
  if (!stream) throw new Error('Twilio voice note was empty')
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_VOICE_NOTE_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('Voice note is too large. Please send a shorter voice note.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (!size) throw new Error('Twilio voice note was empty')
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

async function downloadTrustedTwilioVoiceNote(mediaUrl: string): Promise<ArrayBuffer> {
  const sid = process.env.TWILIO_ACCOUNT_SID || ''
  const token = process.env.TWILIO_AUTH_TOKEN || ''
  if (!sid || !token) throw new Error('Missing Twilio credentials for media download')
  const trusted = trustedTwilioVoiceMediaUrl(mediaUrl, sid)
  if (!trusted) throw new Error('Untrusted Twilio voice media URL')

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  let response = await fetch(trusted, {
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const cdnUrl = trustedTwilioVoiceCdnUrl(response.headers.get('location'))
    if (!cdnUrl) throw new Error('Twilio voice media redirect refused')
    response = await fetch(cdnUrl, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
  }
  // No automatic redirect follows on either hop; do not inspect untrusted error bodies.
  if (!response.ok) throw new Error(`Twilio voice media download failed: ${response.status}`)
  return boundedVoiceAudio(response)
}

export async function transcribeTwilioVoiceNote(params: {
  mediaUrl: string
  contentType: string
}) {
  const { mediaUrl, contentType } = params

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  if (!isAudioContentType(contentType)) throw new Error('Unsupported voice media type')
  const arrayBuffer = await downloadTrustedTwilioVoiceNote(mediaUrl)

  const ext = getExtension(contentType)
  const file = new File([arrayBuffer], `whatsapp-voice.${ext}`, {
    type: contentType || 'audio/ogg',
  })

  const result = await openai.audio.transcriptions.create({
    model: 'gpt-4o-mini-transcribe',
    file,
    response_format: 'json',
    prompt:
      'Transcribe WhatsApp voice notes accurately. The user may speak English, Hindi, Hinglish, Kannada, Tamil, Telugu, Malayalam, or mixed Indian languages. Preserve Indian names, product names, startup terms, and brands exactly when possible. Important vocabulary: Razorpay, Srinivas, Goverdhan, AskGogo, WhatsApp, LinkedIn, Tipplr, ONDC, GoKhana, Digihaat, Vercel, Supabase, Google Calendar, Founder Pro, Bengaluru, Bangalore. Do not change Razorpay to Razor. Do not change Srinivas to Shini. Keep reminder phrases, times, names, places, and user intent clear.',
  })

  const text = (result.text || '').trim()

  if (!text) {
    throw new Error('Could not understand the voice note.')
  }

  return text
}
