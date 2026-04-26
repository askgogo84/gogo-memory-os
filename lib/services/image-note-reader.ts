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

function extractSection(text: string, heading: string) {
  const plain = text.replace(/\*/g, '')
  const regex = new RegExp(`${heading}\\s*\\n([\\s\\S]*?)(?=\\n(?:Summary|Extracted text|Next actions)\\s*\\n|$)`, 'i')
  const match = plain.match(regex)
  return (match?.[1] || '').trim()
}

function cleanBulletLine(line: string) {
  return line.replace(/^[-•\d.)\s]+/, '').replace(/\s+/g, ' ').trim()
}

function titleFromSummary(summaryLines: string[]) {
  const first = summaryLines[0] || 'Image note'
  const clean = first
    .replace(/^the image\s+(discusses|shows|contains|outlines|describes)\s+/i, '')
    .replace(/^this image\s+(discusses|shows|contains|outlines|describes)\s+/i, '')
    .replace(/^a\s+/i, '')
    .replace(/\.$/, '')
    .trim()

  const title = clean.length > 48 ? clean.slice(0, 45).trim() + '...' : clean
  return title ? `Image note — ${title}` : 'Image note'
}

export function compactImageNoteForSaving(text: string) {
  const summary = extractSection(text, 'Summary')
  const extracted = extractSection(text, 'Extracted text')
  const actions = extractSection(text, 'Next actions')

  const summaryLines = summary
    .split('\n')
    .map(cleanBulletLine)
    .filter(Boolean)
    .filter((line) => !/^none$/i.test(line))
    .slice(0, 3)

  const actionLines = actions
    .split('\n')
    .map(cleanBulletLine)
    .filter(Boolean)
    .filter((line) => !/^none$/i.test(line))
    .slice(0, 2)

  const readableExtract = extracted && !/not readable|not clearly readable|no readable text/i.test(extracted)
  const compactParts: string[] = []
  compactParts.push(titleFromSummary(summaryLines))

  if (summaryLines.length) compactParts.push(...summaryLines.map((line) => `• ${line}`))

  if (readableExtract) {
    const shortExtract = extracted.replace(/\s+/g, ' ').trim().slice(0, 220)
    compactParts.push(`Text: ${shortExtract}${extracted.length > 220 ? '...' : ''}`)
  }

  if (actionLines.length) compactParts.push(...actionLines.map((line) => `Action: ${line}`))

  return compactParts.join('\n').trim().slice(0, 900)
}
