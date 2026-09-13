import OpenAI from 'openai'
import { reserveCurrentCost } from '@/lib/services/cost-guard'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
  return (contentType || '').toLowerCase().startsWith('audio/')
}

export async function transcribeTwilioVoiceNote(params: { mediaUrl: string; contentType: string }) {
  const { mediaUrl, contentType } = params
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY')
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) throw new Error('Missing Twilio credentials for media download')

  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
  const mediaResponse = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } })
  if (!mediaResponse.ok) {
    const body = await mediaResponse.text().catch(() => '')
    throw new Error(`Twilio media download failed: ${mediaResponse.status} ${body}`)
  }

  const arrayBuffer = await mediaResponse.arrayBuffer()
  const sizeMb = arrayBuffer.byteLength / (1024 * 1024)
  if (sizeMb > 24) throw new Error('Voice note is too large. Please send a shorter voice note.')

  // WhatsApp Opus/AAC bitrates vary. Reserve conservatively from byte size so long
  // recordings cannot hide inside a single flat "voice action" allowance.
  const conservativeMinutes = Math.max(1, Math.ceil(sizeMb * 4))
  const allowance = await reserveCurrentCost('voice_minute', { provider:'openai', model:'gpt-4o-mini-transcribe', size_mb:Number(sizeMb.toFixed(3)) }, conservativeMinutes)
  if (!allowance.allowed) throw new Error('monthly_cogs_budget_reached')

  const ext = getExtension(contentType)
  const file = new File([arrayBuffer], `whatsapp-voice.${ext}`, { type: contentType || 'audio/ogg' })
  const result = await openai.audio.transcriptions.create({
    model: 'gpt-4o-mini-transcribe', file, response_format: 'json',
    prompt:
      'Transcribe WhatsApp voice notes accurately. The user may speak English, Hindi, Hinglish, Kannada, Tamil, Telugu, Malayalam, or mixed Indian languages. Preserve Indian names, product names, startup terms, and brands exactly when possible. Important vocabulary: Razorpay, Srinivas, Goverdhan, AskGogo, WhatsApp, LinkedIn, Tipplr, ONDC, GoKhana, Digihaat, Vercel, Supabase, Google Calendar, Founder Pro, Bengaluru, Bangalore. Do not change Razorpay to Razor. Do not change Srinivas to Shini. Keep reminder phrases, times, names, places, and user intent clear.',
  })
  const text = (result.text || '').trim()
  if (!text) throw new Error('Could not understand the voice note.')
  return text
}
