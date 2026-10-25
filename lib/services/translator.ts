/**
 * Universal Translation Service
 * - Text translation (any language → any language)
 * - Image translation (menus, signs, documents)
 * - Voice translation
 * - Smart language detection
 */

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export const SUPPORTED_LANGUAGES: Record<string, string> = {
  hindi: 'Hindi', kannada: 'Kannada', tamil: 'Tamil', telugu: 'Telugu',
  malayalam: 'Malayalam', marathi: 'Marathi', gujarati: 'Gujarati',
  punjabi: 'Punjabi', bengali: 'Bengali', urdu: 'Urdu',
  english: 'English', arabic: 'Arabic', french: 'French',
  german: 'German', spanish: 'Spanish', chinese: 'Chinese',
  japanese: 'Japanese', korean: 'Korean', portuguese: 'Portuguese',
  russian: 'Russian', italian: 'Italian', dutch: 'Dutch',
  thai: 'Thai', vietnamese: 'Vietnamese', turkish: 'Turkish',
}

// ── Intent detection ──────────────────────────────────────────────────────────

export function isTranslationRequest(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return (
    /^translate[:\s]/i.test(text) ||
    /^(what does|what is|what's) .+ (mean|in english|in hindi|in kannada|in tamil)/i.test(lower) ||
    /translate (this|it|the following) to/i.test(lower) ||
    /in (english|hindi|kannada|tamil|telugu|french|german|spanish|arabic|japanese|korean|chinese)/i.test(lower) ||
    /^(how do you say|how to say) .+ in/i.test(lower) ||
    lower === 'translate' ||
    /translate to (english|hindi|kannada|tamil|telugu|french|arabic)/i.test(lower)
  )
}

export function isImageTranslationRequest(caption: string): boolean {
  const lower = (caption || '').toLowerCase()
  return (
    /translate|menu|sign|board|what does|what is this|what does it say|read this/i.test(lower) ||
    lower.includes('translate') ||
    lower.includes('menu translation') ||
    lower.includes('what language') ||
    lower.includes('scan menu')
  )
}

// ── Parse target language from request ───────────────────────────────────────

const LANGUAGE_ALT = Object.keys(SUPPORTED_LANGUAGES).join('|')

export function parseTargetLanguage(text: string): string {
  const lower = text.toLowerCase()
  // An explicit "to/into/in <language>" names the target even when another language word appears earlier.
  const explicit = lower.match(new RegExp(`\\b(?:into|to|in)\\s+(${LANGUAGE_ALT})\\b(?![\\s\\S]*\\b(?:into|to|in)\\s+(?:${LANGUAGE_ALT})\\b)`))
  if (explicit) return SUPPORTED_LANGUAGES[explicit[1]]
  for (const [key, name] of Object.entries(SUPPORTED_LANGUAGES)) {
    if (lower.includes(key)) return name
  }
  return 'English' // default to English
}

// ── Text translation ──────────────────────────────────────────────────────────

/**
 * The words to translate, without the instruction around them. 20 Oct live: "Translate good morning to
 * Kannada" sent "good morning to Kannada" to the model, which answered "ಕನ್ನಡಕ್ಕೆ ಶುಭೋದಯ".
 */
export function extractTextToTranslate(text: string): string {
  const lang = `(?:${LANGUAGE_ALT})`
  let t = String(text || '').trim()
  // "Translate to Kannada: good morning" / "translate this into Hindi: ..."
  t = t.replace(new RegExp(`^translate\\s+(?:this|it|the following)?\\s*(?:in)?to\\s+${lang}\\b\\s*[:\\-–]?\\s*`, 'i'), '')
  // "How do you say good morning in Kannada?" / "What does namaskara mean in English?"
  const say = t.match(new RegExp(`^(?:how (?:do (?:you|i)|to) say)\\s+([\\s\\S]+?)\\s+in\\s+${lang}\\s*\\??$`, 'i'))
  if (say) return say[1].replace(/^["'“]|["'”]$/g, '').trim()
  const mean = t.match(/^(?:what does|what is|what's)\s+([\s\S]+?)\s+mean\b/i)
  if (mean) return mean[1].replace(/^["'“]|["'”]$/g, '').trim()
  t = t
    .replace(/^translate[:\s]+/i, '')
    .replace(/^(?:this|it|the following)\s*[:\-–]\s*/i, '')
    // Trailing target: "good morning to Kannada", "good morning into Hindi", "good morning in Tamil please"
    .replace(new RegExp(`\\s+(?:in|into|to)\\s+${lang}\\b(?:\\s+(?:please|pls|language))?\\s*[.?!]*$`, 'i'), '')
    // Leading target left over: "in Kannada: good morning"
    .replace(new RegExp(`^(?:in|into|to)\\s+${lang}\\b\\s*[:\\-–]?\\s*`, 'i'), '')
    .trim()
  return t.replace(/^["'“]([\s\S]*)["'”]$/, '$1').trim()
}

const LATIN_SCRIPT_TARGETS = new Set(['English', 'French', 'German', 'Spanish', 'Portuguese', 'Italian', 'Dutch', 'Turkish', 'Vietnamese'])

export async function translateText(params: {
  text: string
  targetLanguage?: string
  sourceLanguage?: string
}): Promise<{ translation: string; detectedLanguage: string; targetLanguage: string; transliteration?: string }> {
  const target = params.targetLanguage || 'English'
  const textToTranslate = extractTextToTranslate(params.text)
  const wantsRoman = !LATIN_SCRIPT_TARGETS.has(target)

  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Detect the language of this text and translate it to ${target}. Translate only the text; do not add the language name or any note.

Text: "${textToTranslate}"

Return ONLY valid JSON:
{"detected_language": "Hindi", "translation": "translated text here"${wantsRoman ? ', "transliteration": "the translation in Latin letters"' : ''}}`
    }]
  })

  const raw = result.content[0]?.type === 'text' ? result.content[0].text.trim() : ''
  const clean = raw.replace(/```json|```/g, '').trim()

  try {
    const parsed = JSON.parse(clean)
    const transliteration = wantsRoman && typeof parsed.transliteration === 'string' ? parsed.transliteration.trim() : ''
    return {
      translation: parsed.translation,
      detectedLanguage: parsed.detected_language,
      targetLanguage: target,
      ...(transliteration && transliteration !== String(parsed.translation || '').trim() ? { transliteration } : {}),
    }
  } catch {
    return { translation: raw, detectedLanguage: 'Unknown', targetLanguage: target }
  }
}

// ── Image translation (menus, signs, documents) ───────────────────────────────

export async function translateImage(params: {
  imageBase64: string
  mediaType: string
  caption?: string
  targetLanguage?: string
}): Promise<string> {
  const target = params.targetLanguage || 'English'
  const isMenu = /menu|food|restaurant|cafe|dish/i.test(params.caption || '')
  const isSign = /sign|board|notice|poster/i.test(params.caption || '')

  const systemPrompt = isMenu
    ? `You are a menu translator. Extract all menu items from the image and translate them to ${target}. Format as a clean menu list with prices if visible.`
    : isSign
    ? `You are a sign/notice translator. Read all text in the image and translate to ${target}. Be accurate and complete.`
    : `You are a document translator. Read all text visible in the image and translate to ${target}. Preserve the structure and formatting.`

  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: params.mediaType as any, data: params.imageBase64 }
        },
        {
          type: 'text',
          text: isMenu
            ? `This is a restaurant menu. Translate all items to ${target}. Format:
📋 *Menu Translation*

[Category if visible]
• [Item name in ${target}] — [original name] — [price if visible]

If no text found, say so.`
            : `Read and translate all text in this image to ${target}. 
If it's a menu: list all items with prices.
If it's a sign/notice: give the full translation.
If it's a document: translate the content.
Start with what language the original is in.`
        }
      ]
    }]
  })

  return result.content[0]?.type === 'text' ? result.content[0].text.trim() : 'Could not read the image.'
}

// ── Build WhatsApp reply for text translation ─────────────────────────────────

export function buildTranslationReply(result: {
  translation: string
  detectedLanguage: string
  targetLanguage: string
  originalText?: string
  transliteration?: string
}): string {
  const flag: Record<string, string> = {
    Hindi: '🇮🇳', Kannada: '🇮🇳', Tamil: '🇮🇳', Telugu: '🇮🇳',
    Malayalam: '🇮🇳', Marathi: '🇮🇳', Gujarati: '🇮🇳',
    English: '🇬🇧', Arabic: '🇸🇦', French: '🇫🇷',
    German: '🇩🇪', Spanish: '🇪🇸', Chinese: '🇨🇳',
    Japanese: '🇯🇵', Korean: '🇰🇷', Portuguese: '🇵🇹',
    Russian: '🇷🇺', Italian: '🇮🇹', Turkish: '🇹🇷',
  }

  const fromFlag = flag[result.detectedLanguage] || '🌐'
  const toFlag = flag[result.targetLanguage] || '🌐'

  return (
    `${fromFlag} *${result.detectedLanguage} → ${toFlag} ${result.targetLanguage}*\n\n` +
    `${result.translation}\n` +
    (result.transliteration ? `(${result.transliteration})\n` : '') +
    // Plain text footer: the user dislikes italics (20 Oct).
    `\nSay "translate to Hindi" or "translate to French" for other languages.`
  )
}

// ── Build WhatsApp reply for image translation ────────────────────────────────

export function buildImageTranslationReply(translation: string, isMenu: boolean): string {
  const header = isMenu ? '🍽️ *Menu Translation*\n\n' : '🌐 *Image Translation*\n\n'
  return header + translation + '\n\nSend another image to translate.'
}
