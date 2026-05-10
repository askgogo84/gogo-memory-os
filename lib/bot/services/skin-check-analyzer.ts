import OpenAI from 'openai'
import { downloadTwilioMediaAsDataUrl } from '@/lib/services/image-note-reader'
import { buildSkinCheckSystemPrompt, buildSkinCheckUserPrompt } from '@/lib/bot/prompts/skin-check-prompt'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function analyzeSkinCheckImage(params: {
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

  const text = response.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('Could not create skin check report')
  return text
}
