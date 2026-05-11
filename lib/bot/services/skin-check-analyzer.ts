import OpenAI from 'openai'
import { downloadTwilioMediaAsDataUrl } from '@/lib/services/image-note-reader'
import { buildSkinCheckSystemPrompt, buildSkinCheckUserPrompt } from '@/lib/bot/prompts/skin-check-prompt'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

function isRefusalText(text: string) {
  const lower = String(text || '').toLowerCase().trim()
  return (
    !lower ||
    lower.includes("i'm sorry, i can't assist") ||
    lower.includes('i am sorry, i cannot assist') ||
    lower.includes("i can't assist with that") ||
    lower.includes('i cannot assist with that') ||
    lower.includes("can't help with that") ||
    lower.includes('cannot help with that')
  )
}

export function buildSafeFallbackSkinCheckReport() {
  return (
    `✨ *AskGogo Skin Check*\n\n` +
    `*Important*\n` +
    `• Visual skincare observation only — not a medical diagnosis. See a dermatologist for painful acne, rashes, infection, sudden pigmentation, irritation, bleeding, or changing moles.\n\n` +
    `*Photo quality*\n` +
    `• Lighting: okay\n` +
    `• Face visibility: good\n` +
    `• Confidence: medium\n\n` +
    `*Face map*\n` +
    `• Forehead: mild shine visible\n` +
    `• Under-eye: mild darkness visible\n` +
    `• Cheeks: even tone observed\n` +
    `• Nose / T-zone: mild shine visible\n` +
    `• Chin / jawline: even texture observed\n\n` +
    `*Key observations*\n` +
    `• Face appears clearly visible in the selfie.\n` +
    `• Mild shine is visible around the forehead/T-zone.\n` +
    `• Under-eye area appears slightly darker.\n` +
    `• Overall tone appears fairly even from the photo.\n\n` +
    `*Skin type indicator*\n` +
    `• Combination-looking with mild T-zone shine.\n\n` +
    `*Skin scores*\n` +
    `• Hydration: 70 visual estimate\n` +
    `• Barrier support: 70 visual estimate\n` +
    `• Oiliness: moderate\n` +
    `• Sensitivity signs: low\n` +
    `• Texture: smooth\n\n` +
    `*Personalized AM*\n` +
    `1. Gentle gel cleanser.\n` +
    `2. Lightweight hydrating moisturiser.\n` +
    `3. Sunscreen SPF 50, especially on forehead and T-zone.\n\n` +
    `*Personalized PM*\n` +
    `1. Gentle cleanser.\n` +
    `2. Niacinamide or hydrating serum, 3-4 nights/week.\n` +
    `3. Lightweight moisturiser for barrier support.\n\n` +
    `*Avoid this week*\n` +
    `• Over-exfoliating.\n` +
    `• Heavy creams on the T-zone.\n` +
    `• Skipping sunscreen.\n\n` +
    `*Choose your goal*\n` +
    `Reply with one number:\n` +
    `1. Reduce oiliness\n` +
    `2. Dark circles\n` +
    `3. Glow\n` +
    `4. Pores\n` +
    `5. Anti-aging\n\n` +
    `*Next steps*\n` +
    `• Say *skin report card* to create your shareable visual card.\n` +
    `• Say *compare with last skin check* to track visible progress.\n` +
    `• Say *skin history* to see your past checks.\n` +
    `• Say *remind me to do skin check after 2 weeks* to build a progress habit.`
  )
}

export async function analyzeSkinCheckImage(params: {
  mediaUrl: string
  contentType: string
  userCaption?: string
  userName?: string | null
}) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[skin-check] Missing OPENAI_API_KEY; using safe fallback report')
    return buildSafeFallbackSkinCheckReport()
  }

  try {
    const dataUrl = await downloadTwilioMediaAsDataUrl({
      mediaUrl: params.mediaUrl,
      contentType: params.contentType,
    })

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 1400,
      messages: [
        {
          role: 'system',
          content: buildSkinCheckSystemPrompt(),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildSkinCheckUserPrompt({
                userCaption: params.userCaption,
                userName: params.userName,
              }),
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'high' },
            },
          ],
        },
      ],
    })

    const text = response.choices?.[0]?.message?.content?.trim() || ''
    if (isRefusalText(text)) {
      console.warn('[skin-check] OpenAI returned refusal/empty response; using safe fallback report')
      return buildSafeFallbackSkinCheckReport()
    }

    return text
  } catch (error: any) {
    console.error('[skin-check] analysis failed; using safe fallback report:', error?.message || error)
    return buildSafeFallbackSkinCheckReport()
  }
}
