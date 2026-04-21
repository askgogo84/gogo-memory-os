import OpenAI from 'openai'
import { toFile } from 'openai'

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  return new OpenAI({ apiKey })
}

export async function transcribeVoice(fileBuffer: Buffer): Promise<string> {
  const openai = getOpenAIClient()
  const file = await toFile(fileBuffer, 'voice.ogg', { type: 'audio/ogg' })

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
  })

  return transcription.text
}

export async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const token = process.env.TELEGRAM_BOT_TOKEN

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set')
  }

  const fileRes = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
  )
  const fileData = await fileRes.json()
  const filePath = fileData.result.file_path

  const downloadRes = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePath}`
  )
  const arrayBuffer = await downloadRes.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
