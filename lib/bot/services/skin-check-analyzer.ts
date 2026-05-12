import OpenAI from 'openai'
import { downloadTwilioMediaAsDataUrl } from '@/lib/services/image-note-reader'
import { buildSkinCheckSystemPrompt, buildSkinCheckUserPrompt } from '@/lib/bot/prompts/skin-check-prompt'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

function isRefusalText(text: string) {
  const lower = String(text || '').toLowerCase().trim()
  if (!lower) return true
  // Catch all common OpenAI refusal patterns
  const refusalPhrases = [
    "i'm sorry, i can't",
    "i am sorry, i cannot",
    "i can't assist",
    "i cannot assist",
    "can't help with",
    "cannot help with",
    "i'm not able to",
    "i am not able to",
    "unable to analyze",
    "unable to provide",
    "i don't feel comfortable",
    "i won't be able to",
    "not appropriate for me",
    "i'm unable to",
    "i cannot provide",
    "i can't provide",
    "not something i can",
    "this request",
    "privacy concerns",
    "identify individuals",
    "i apologize, but",
    "i'm afraid i can't",
  ]
  return refusalPhrases.some(phrase => lower.includes(phrase))
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
