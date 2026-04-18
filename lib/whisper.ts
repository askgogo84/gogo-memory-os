import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function transcribeVoice(fileBuffer: Buffer, mimeType: string): Promise<string> {
  // Download voice file and transcribe via Whisper
  const file = new File([fileBuffer], 'voice.ogg', { type: mimeType })
  
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
  })

  return transcription.text
}

export async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const token = process.env.TELEGRAM_BOT_TOKEN!
  
  // Get file path from Telegram
  const fileRes = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
  )
  const fileData = await fileRes.json()
  const filePath = fileData.result.file_path

  // Download actual file
  const downloadRes = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePath}`
  )
  const arrayBuffer = await downloadRes.arrayBuffer()
  return Buffer.from(arrayBuffer)
}