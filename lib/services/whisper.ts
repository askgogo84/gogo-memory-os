import OpenAI from 'openai'
// Per-user gate (21 Nov): the switch, the key, the production approval AND the person served being in GOGO_SARVAM_USERS.
import { sarvamEnabled } from './sarvam-gate'

import { toFile } from 'openai'

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
  return new OpenAI({ apiKey })
}

export async function transcribeVoice(fileBuffer: Buffer): Promise<string> {
  if (sarvamEnabled('GOGO_SARVAM_STT')) {
    try {
      const { sarvamSpeechToText } = await import('./sarvam-voice')
      return (await sarvamSpeechToText(fileBuffer, 'audio/ogg', { mode: 'codemix' })).text
    } catch (e: any) { console.error('SARVAM_STT_FALLBACK:', String(e?.code || 'provider_error').slice(0, 50)) }
  }
  const openai = getOpenAIClient()
  const file = await toFile(fileBuffer, 'voice.ogg', { type: 'audio/ogg' })
  // No language = auto-detect: Tamil, Kannada, Hindi, English, 96+ languages
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
  })
  return transcription.text
}

export async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set')
  const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)
  const fileData = await fileRes.json()
  const filePath = fileData.result.file_path
  const downloadRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)
  const arrayBuffer = await downloadRes.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
