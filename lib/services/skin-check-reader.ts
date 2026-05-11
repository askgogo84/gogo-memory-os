import OpenAI from 'openai'
import { downloadTwilioMediaAsDataUrl } from '@/lib/services/image-note-reader'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export function isSkinCheckCaption(text: string | null | undefined) {
  const lower = (text || '').toLowerCase().trim().replace(/\s+/g, ' ')

  return (
    lower === 'skin' ||
    lower === 'skin check' ||
    lower === 'check skin' ||
    lower === 'skin scan' ||
    lower === 'scan skin' ||
    lower === 'scan my skin' ||
    lower === 'skin analysis' ||
    lower === 'face analysis' ||
    lower === 'face check' ||
    lower === 'check face' ||
    lower === 'skin selfie' ||
    lower === 'selfie skin check' ||
    lower === 'analyse my skin' ||
    lower === 'analyze my skin' ||
    lower === 'check my skin' ||
    lower === 'skincare check' ||
    lower.includes('skin check') ||
    lower.includes('check skin') ||
    lower.includes('skin scan') ||
    lower.includes('scan skin') ||
    lower.includes('scan my skin') ||
    lower.includes('skin analysis') ||
    lower.includes('face analysis') ||
    lower.includes('face check') ||
    lower.includes('check face') ||
    lower.includes('skin selfie') ||
    lower.includes('selfie skin') ||
    lower.includes('skincare')
  )
}

export async function buildSkinCheckReport(params: {
  mediaUrl: string
  contentType: string
  userCaption?: string
  userName?: string | null
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const dataUrl = await downloadTwilioMediaAsDataUrl({
    mediaUrl: params.mediaUrl,
    contentType: params.contentType,
  })

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    max_tokens: 1200,
    messages: [
      {
        role: 'system',
        content:
          'You are AskGogo Skin Check, a cosmetic/wellness image assistant. You give visual skincare observations from selfies. You must not diagnose diseases, identify medical conditions, estimate age, judge attractiveness, or make certainty claims. Do not mention protected attributes. Avoid terms like acne diagnosis, rosacea, melasma, infection, cancer, or treatment unless warning the user to consult a dermatologist. Use cautious language: appears, visible, looks like, possible. Return WhatsApp-friendly text only.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `User caption: ${params.userCaption || 'No caption'}\n` +
              `User name: ${params.userName || 'there'}\n\n` +
              'Analyze this selfie/photo only as a non-medical skincare observation. Output exactly in this format:\n\n' +
              '✨ *AskGogo Skin Check*\n\n' +
              '*Important*\n' +
              '• This is a visual skincare observation, not a medical diagnosis. For painful acne, rashes, infection, sudden pigmentation, irritation, bleeding, or changing moles, consult a dermatologist.\n\n' +
              '*Photo quality*\n' +
              '• Lighting: good / okay / poor\n' +
              '• Face visibility: good / partial / unclear\n' +
              '• Confidence: high / medium / low\n\n' +
              '*Visible observations*\n' +
              '• 4 to 6 short bullets about visible shine, dryness-looking areas, redness-like areas, texture, pores, under-eye area, or uneven tone. Use cautious language.\n\n' +
              '*Possible skin type indicators*\n' +
              '• One cautious line such as normal / combination / oily-looking / dry-looking / sensitive-looking indicators.\n\n' +
              '*Suggested AM routine*\n' +
              '1. Gentle cleanser\n' +
              '2. Hydrating serum or light moisturiser\n' +
              '3. Barrier-support moisturiser if dry\n' +
              '4. Sunscreen SPF 30+ or 50\n\n' +
              '*Suggested PM routine*\n' +
              '1. Gentle cleanser\n' +
              '2. Hydrating/barrier serum or niacinamide if suitable\n' +
              '3. Moisturiser\n\n' +
              '*Avoid / caution*\n' +
              '• 3 practical cautions like over-exfoliation, harsh scrubs, mixing too many actives, fragrance if sensitive.\n\n' +
              '*Progress tip*\n' +
              '• Suggest taking another selfie in similar lighting after 2 weeks and saving it to AskGogo.',
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
  if (!text) throw new Error('Could not create skin check report')
  return text
}

function extractSection(text: string, heading: string) {
  const plain = text.replace(/\*/g, '')
  const regex = new RegExp(`${heading}\\s*\\n([\\s\\S]*?)(?=\\n(?:Important|Photo quality|Visible observations|Possible skin type indicators|Suggested AM routine|Suggested PM routine|Avoid / caution|Progress tip)\\s*\\n|$)`, 'i')
  const match = plain.match(regex)
  return (match?.[1] || '').trim()
}

function cleanLine(line: string) {
  return (line || '')
    .replace(/^[-•\d.)\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function compactSkinCheckForSaving(text: string) {
  const observations = extractSection(text, 'Visible observations')
  const skinType = extractSection(text, 'Possible skin type indicators')
  const avoid = extractSection(text, 'Avoid / caution')

  const observationLines = observations
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
    .slice(0, 4)

  const avoidLines = avoid
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
    .slice(0, 2)

  const parts = ['Skin check report']
  const skinTypeLine = cleanLine(skinType).slice(0, 120)
  if (skinTypeLine) parts.push(`• Indicators: ${skinTypeLine}`)
  if (observationLines.length) parts.push(...observationLines.map((line) => `• ${line}`))
  if (avoidLines.length) parts.push(...avoidLines.map((line) => `Caution: ${line}`))

  return parts.join('\n').trim().slice(0, 1200)
}
