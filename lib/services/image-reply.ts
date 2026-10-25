// Image generation (Muse parity case 24): invites, posters, cards and simple graphics, made with
// OpenAI image generation, stored privately and sent to WhatsApp through a short-lived link.
import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BUCKET = 'user-documents'

/** "Make an invite image for …", "create a poster for …", "design a birthday card …". */
export function imageRequest(text: string): string | null {
  const t = String(text || '').trim()
  if (!t || t.length > 800) return null
  if (/\bremind|\breminder\b|\bnutrition\b|\bskin\b|\breport\s+card\b|\bcalendar\b/i.test(t)) return null
  const asks = /\b(?:make|create|generate|design|draw|paint|illustrate)\b[^.?!]{0,40}\b(?:image|picture|pic|poster|invite|invitation|greeting\s+card|birthday\s+card|card|flyer|banner|illustration|wallpaper|graphic|thumbnail|sticker)\b/i.test(t)
  return asks ? t : null
}

/** Requests Gogo will not draw: real people's likeness (including the user's own photo). */
export function imageRequestRefusal(text: string): string | null {
  if (/\b(?:photo|picture|image|likeness|portrait)\s+of\s+(?:me|my\s+face|myself|him|her|them)\b/i.test(text)) {
    return "I can't create images of real people, including you. I can make an illustration, invite or poster without a real person's likeness."
  }
  return null
}

function prompt(text: string) {
  return `${text}\n\nDesign notes: clean, tasteful and easy to read on a phone. If the request includes words to show (names, dates, times, places), render them exactly as written and spell them correctly. No real people, no brand logos or trademarked characters.`
}

/** Generate one image; returns a signed PNG link, or null if it could not be made. */
export async function createImage(telegramId: number | string, text: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const attempts: Array<Record<string, unknown>> = [
    { model: process.env.GOGO_IMAGE_MODEL || 'gpt-image-1', prompt: prompt(text), size: '1024x1024' },
    { model: 'dall-e-3', prompt: prompt(text), size: '1024x1024', response_format: 'b64_json' },
  ]
  for (const params of attempts) {
    try {
      const res: any = await openai.images.generate(params as any)
      const b64 = res?.data?.[0]?.b64_json
      if (!b64) continue
      const path = `${telegramId}/images/${randomUUID()}.png`
      const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, Buffer.from(b64, 'base64'), { contentType: 'image/png', upsert: false })
      if (error) throw new Error(`image_upload_failed:${error.message}`)
      const { data, error: signError } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 3600)
      if (signError || !data?.signedUrl) throw new Error(`image_sign_failed:${signError?.message || 'unknown'}`)
      return data.signedUrl
    } catch (error: any) {
      console.error('IMAGE_GENERATION_FAILED:', String(params.model), String(error?.message || error).slice(0, 160))
    }
  }
  return null
}
