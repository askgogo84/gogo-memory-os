import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export function isImageContentType(contentType: string | null | undefined) {
  const type = (contentType || '').toLowerCase()
  return type.startsWith('image/')
}

function normalizeMime(contentType: string) {
  const type = (contentType || '').toLowerCase()
  if (type.includes('png')) return 'image/png'
  if (type.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}

export async function downloadTwilioMediaAsDataUrl(params: {
  mediaUrl: string
  contentType: string
}) {
  const { mediaUrl, contentType } = params

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error('Missing Twilio credentials for media download')
  }

  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString('base64')

  const mediaResponse = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
  })

  if (!mediaResponse.ok) {
    const body = await mediaResponse.text().catch(() => '')
    throw new Error(`Twilio image download failed: ${mediaResponse.status} ${body}`)
  }

  const arrayBuffer = await mediaResponse.arrayBuffer()
  const sizeMb = arrayBuffer.byteLength / (1024 * 1024)

  if (sizeMb > 18) {
    throw new Error('Image is too large. Please send a smaller image.')
  }

  const base64 = Buffer.from(arrayBuffer).toString('base64')
  return `data:${normalizeMime(contentType)};base64,${base64}`
}

export async function readAndSummarizeImageNote(params: {
  mediaUrl: string
  contentType: string
  userCaption?: string
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const dataUrl = await downloadTwilioMediaAsDataUrl(params)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 700,
    messages: [
      {
        role: 'system',
        content:
          'You are AskGogo reading a WhatsApp image. Extract readable text from handwritten notes, diary pages, screenshots, whiteboards, bills, or documents. Then provide a concise useful summary. If the image is not a note/document, describe it briefly. Return plain WhatsApp-friendly text only.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `User caption: ${params.userCaption || 'No caption'}\n\n` +
              'Read this image carefully. Output exactly in this format:\n\n' +
              '📝 *Image note read*\n\n' +
              '*Summary*\n' +
              '• bullet 1\n' +
              '• bullet 2\n\n' +
              '*Extracted text*\n' +
              'short extracted text, or say if text was not readable\n\n' +
              '*Next actions*\n' +
              '• action if any',
          },
          {
            type: 'image_url',
            image_url: { url: dataUrl },
          },
        ],
      },
    ],
  })

  const text = response.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('Could not read image note')
  return text
}

export function compactImageNoteForSaving(text: string) {
  return text
    .replace(/\*/g, '')
    .replace(/📝\s*Image note read/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1200)
}
