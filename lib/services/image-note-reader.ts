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

function isLikelyMedicalImage(caption?: string) {
  const text = (caption || '').toLowerCase()
  return /prescription|doctor|medicine|tablet|pill|clinic|medical|report|bp|cholesterol|ldl|tg|triglyceride|sugar|dose|dosage/i.test(text)
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
  const captionMedicalMode = isLikelyMedicalImage(params.userCaption)

  const response = await openai.chat.completions.create({
    // Use stronger vision for all images now because users are sending receipts/prescriptions/handwritten notes.
    // The prompt auto-switches to medical-safe output when it sees a prescription/clinic/medical note.
    model: 'gpt-4o',
    temperature: 0,
    max_tokens: 1200,
    messages: [
      {
        role: 'system',
        content:
          'You are AskGogo reading a WhatsApp image. First decide whether the image is a medical prescription/health note, a normal note/document, bill/receipt, screenshot, or other image. If it is a prescription or health note, you must never guess medicine names, dosage, timing, diagnosis, or lab values when handwriting is unclear. Mark unclear words as [unclear]. Do not give medical advice. For normal notes, extract readable text and summarize. Return plain WhatsApp-friendly text only.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `User caption: ${params.userCaption || 'No caption'}\n` +
              `Caption medical hint: ${captionMedicalMode ? 'yes' : 'no'}\n\n` +
              'Read this image carefully. If the image appears to be a doctor prescription, clinic note, lab/health note, medicine note, or has doctor/clinic/medicine/lab values, output exactly this medical format:\n\n' +
              '📝 *Prescription / medical note read*\n\n' +
              '*Important*\n' +
              '• Handwritten prescriptions can be unclear. Please verify medicine names, dosage, and timing with the doctor/pharmacist.\n\n' +
              '*Patient / clinic details*\n' +
              '• Patient: name and age if visible, otherwise [unclear]\n' +
              '• Doctor/clinic: if visible\n' +
              '• Date: if visible\n\n' +
              '*Vitals / test values visible*\n' +
              '• List visible values like TG, LDL, BP exactly as written. Use [unclear] if unsure.\n\n' +
              '*Medicines / instructions visible*\n' +
              '• Medicine name: [exact visible text or unclear]\n' +
              '• Strength: [visible strength or unclear]\n' +
              '• Timing/dosage: [visible timing or unclear]\n' +
              '• Duration: [visible duration or unclear]\n\n' +
              '*Extracted text*\n' +
              'Line-by-line transcription. Preserve uncertainty with [unclear].\n\n' +
              '*Next actions*\n' +
              '• Practical next steps only. If medicine/timing is unclear, ask user to send a close-up crop of just the medicine line.\n\n' +
              'If the image is NOT medical, output exactly this normal format:\n\n' +
              '📝 *Image note read*\n\n' +
              '*Summary*\n' +
              '• bullet 1\n' +
              '• bullet 2\n\n' +
              '*Extracted text*\n' +
              'short extracted text, or say if text was not readable. Use [unclear] instead of guessing.\n\n' +
              '*Next actions*\n' +
              '• action if any',
          },
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
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
  const regex = new RegExp(`${heading}\\s*\\n([\\s\\S]*?)(?=\\n(?:Important|Summary|Patient / clinic details|Vitals / test values visible|Medicines / instructions visible|Extracted text|Next actions)\\s*\\n|$)`, 'i')
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
  const patient = extractSection(text, 'Patient / clinic details')
  const vitals = extractSection(text, 'Vitals / test values visible')
  const medicines = extractSection(text, 'Medicines / instructions visible')
  const extracted = extractSection(text, 'Extracted text')
  const actions = extractSection(text, 'Next actions')

  const medicalMode = /Prescription \/ medical note read|Medicines \/ instructions visible|Patient \/ clinic details/i.test(text)

  const summaryLines = (medicalMode ? [patient, vitals, medicines].join('\n') : summary)
    .split('\n')
    .map(cleanBulletLine)
    .filter(Boolean)
    .filter((line) => !/^none$/i.test(line))
    .slice(0, medicalMode ? 8 : 3)

  const actionLines = actions
    .split('\n')
    .map(cleanBulletLine)
    .filter(Boolean)
    .filter((line) => !/^none$/i.test(line))
    .slice(0, 2)

  const readableExtract = extracted && !/not readable|not clearly readable|no readable text/i.test(extracted)
  const compactParts: string[] = []
  compactParts.push(medicalMode ? 'Medical note / prescription image' : titleFromSummary(summaryLines))

  if (summaryLines.length) compactParts.push(...summaryLines.map((line) => `• ${line}`))

  if (readableExtract) {
    const shortExtract = extracted.replace(/\s+/g, ' ').trim().slice(0, medicalMode ? 360 : 220)
    compactParts.push(`Text: ${shortExtract}${extracted.length > (medicalMode ? 360 : 220) ? '...' : ''}`)
  }

  if (actionLines.length) compactParts.push(...actionLines.map((line) => `Action: ${line}`))

  return compactParts.join('\n').trim().slice(0, medicalMode ? 1400 : 900)
}
