/**
 * Instagram Reel / YouTube Short / TikTok saver
 * 
 * Flow:
 * 1. Detect if message contains a social video URL
 * 2. Fetch video metadata via oEmbed (title, author, thumbnail)
 * 3. Try to get caption/description from the URL
 * 4. Use Claude to create a useful note from the metadata
 * 5. Save to user's notes with the original URL
 */

import OpenAI from 'openai'

export type ReelSaveResult = {
  url: string
  platform: 'instagram' | 'youtube' | 'tiktok' | 'other'
  title: string
  author: string
  summary: string
  savedNote: string
}

// Detect Instagram link preview card (WhatsApp forward without full URL)
// Format: "Name on Instagram: "caption text...""
export function detectInstagramPreviewCard(text: string): boolean {
  const t = (text || '').trim()
  return (
    /on instagram:\s*[""]/.test(t.toLowerCase()) ||
    /on instagram\.?\s*$/.test(t.toLowerCase()) ||
    /instagram\.com\/reel/i.test(t) ||
    /instagram\.com\/p\//i.test(t) ||
    (/instagram/i.test(t) && /reel/i.test(t))
  )
}

// Detect social video URLs
export function detectReelUrl(text: string): string | null {
  const patterns = [
    /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[^\s\/?#]+/i,
    /https?:\/\/(?:www\.)?instagram\.com\/stories\/[^\s\/?#]+\/[^\s\/?#]+/i,
    /https?:\/\/(?:www\.)?youtu\.be\/[^\s\/?#]+/i,
    /https?:\/\/(?:www\.)?youtube\.com\/(?:shorts|watch)\?[^\s]+/i,
    /https?:\/\/(?:vm\.)?tiktok\.com\/[^\s\/?#]+/i,
    /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s\/]+\/video\/[^\s\/?#]+/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[0]
  }
  return null
}

export function detectPlatform(url: string): ReelSaveResult['platform'] {
  if (/instagram\.com/i.test(url)) return 'instagram'
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube'
  if (/tiktok\.com/i.test(url)) return 'tiktok'
  return 'other'
}

// Try Instagram oEmbed for metadata
async function fetchInstagramMeta(url: string): Promise<{ title: string; author: string; thumbnail: string } | null> {
  try {
    const oembedUrl = `https://graph.facebook.com/v19.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${process.env.FACEBOOK_APP_TOKEN || ''}&fields=title,author_name,thumbnail_url`
    const r = await fetch(oembedUrl)
    if (!r.ok) return null
    const d = await r.json()
    return { title: d.title || '', author: d.author_name || '', thumbnail: d.thumbnail_url || '' }
  } catch { return null }
}

// Try YouTube oEmbed
async function fetchYouTubeMeta(url: string): Promise<{ title: string; author: string } | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    const r = await fetch(oembedUrl)
    if (!r.ok) return null
    const d = await r.json()
    return { title: d.title || '', author: d.author_name || '' }
  } catch { return null }
}

// Use Claude to create a useful note from what we know about the URL
async function buildReelNote(params: {
  url: string
  platform: string
  title: string
  author: string
  userCaption?: string
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('No OpenAI key')

  const openai = new OpenAI({ apiKey })

  const contextLines = [
    `Platform: ${params.platform}`,
    `URL: ${params.url}`,
    params.title ? `Title: ${params.title}` : null,
    params.author ? `Author/Creator: @${params.author}` : null,
    params.userCaption ? `User caption: ${params.userCaption}` : null,
  ].filter(Boolean).join('\n')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: 'You create concise, useful notes from social media video metadata. Be specific, practical, and helpful. Extract what this content is about and why someone would want to save it. Format for WhatsApp (no markdown headers). Keep it under 5 lines.'
      },
      {
        role: 'user',
        content: `Create a useful note for this saved ${params.platform} video:\n\n${contextLines}\n\nWhat is this video likely about, and what key info should the user remember?`
      }
    ]
  })

  return response.choices[0]?.message?.content?.trim() || ''
}

export async function saveReel(params: {
  url: string
  userCaption?: string
}): Promise<ReelSaveResult> {
  const platform = detectPlatform(params.url)
  let title = ''
  let author = ''

  // Try to get metadata
  if (platform === 'instagram') {
    const meta = await fetchInstagramMeta(params.url)
    title = meta?.title || ''
    author = meta?.author || ''
  } else if (platform === 'youtube') {
    const meta = await fetchYouTubeMeta(params.url)
    title = meta?.title || ''
    author = meta?.author || ''
  }

  // If no title from oEmbed, extract from URL slug
  if (!title) {
    const slug = params.url.split('/').filter(Boolean).pop() || ''
    title = slug.replace(/[-_]/g, ' ').slice(0, 60)
  }

  // Build the note
  let summary = ''
  try {
    summary = await buildReelNote({ url: params.url, platform, title, author, userCaption: params.userCaption })
  } catch {
    summary = `${platform.charAt(0).toUpperCase() + platform.slice(1)} ${title ? `— ${title}` : 'video'} by ${author || 'unknown creator'}`
  }

  const platformLabel = platform === 'instagram' ? 'Instagram Reel' : platform === 'youtube' ? 'YouTube Short' : platform === 'tiktok' ? 'TikTok' : 'Video'
  const savedNote = [
    `📱 *${platformLabel} saved*`,
    author ? `@${author}` : null,
    title ? title : null,
    '',
    summary,
    '',
    `🔗 ${params.url}`,
    params.userCaption ? `💬 "${params.userCaption}"` : null
  ].filter(s => s !== null).join('\n')

  return { url: params.url, platform, title, author, summary, savedNote }
}

// ─────────────────────────────────────────────────────────────
// Instagram thumbnail analyser — works when user forwards reel
// (Twilio sends thumbnail as MediaUrl0 + caption as Body text)
// ─────────────────────────────────────────────────────────────

export function isInstagramReelPreview(bodyText: string): boolean {
  const t = (bodyText || '').trim()
  return (
    // "Name on Instagram: "caption"" pattern
    /on instagram:\s*["""]/i.test(t) ||
    /on instagram\s*$/i.test(t) ||
    // Contains instagram.com domain reference
    /instagram\.com/i.test(t) ||
    // Magnetic Shark / business accounts pattern
    (/instagram/i.test(t) && t.length > 10)
  )
}

export async function analyseInstagramThumbnail(params: {
  mediaUrl: string
  contentType: string
  captionText: string
}): Promise<string> {
  const OpenAI = (await import('openai')).default
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  // Download thumbnail with Twilio auth
  const sid = process.env.TWILIO_ACCOUNT_SID
  const tok = process.env.TWILIO_AUTH_TOKEN
  let imageDataUrl: string | null = null

  if (sid && tok) {
    try {
      const res = await fetch(params.mediaUrl, {
        headers: { Authorization: `Basic ${btoa(`${sid}:${tok}`)}` }
      })
      if (res.ok) {
        const buf = await res.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let b = ''
        bytes.forEach(x => b += String.fromCharCode(x))
        imageDataUrl = `data:image/jpeg;base64,${btoa(b)}`
      }
    } catch { /* fall through to text-only mode */ }
  }

  // Extract creator name from caption text
  // Format: "Creator Name on Instagram: "caption text""
  const creatorMatch = params.captionText.match(/^(.+?)\s+on\s+instagram/i)
  const creator = creatorMatch?.[1]?.trim() || ''

  // Extract caption snippet
  const captionMatch = params.captionText.match(/on instagram:\s*["""](.*?)["""]/i)
  const captionSnippet = captionMatch?.[1]?.trim() || params.captionText.slice(0, 100)

  const messages: any[] = [
    {
      role: 'system',
      content: `You are AskGogo, helping users save and understand Instagram content they forward on WhatsApp. 
      Analyse the thumbnail image and caption text to create a useful summary note.
      Be specific about what the content shows/teaches. Format for WhatsApp.
      Keep response under 200 words. End with the caption text as a quote.`
    },
    {
      role: 'user',
      content: imageDataUrl
        ? [
            {
              type: 'image_url',
              image_url: { url: imageDataUrl, detail: 'low' }
            },
            {
              type: 'text',
              text: `This is a forwarded Instagram post${creator ? ` by @${creator}` : ''}.
Caption: "${captionSnippet}"

Analyse the thumbnail image and caption. Create a useful note that captures:
1. What this content is about (be specific from the image)
2. The key insight or tip (if it's educational/informational)
3. Why someone would want to save it

Then confirm it's saved.`
            }
          ]
        : [
            {
              type: 'text',
              text: `Forwarded Instagram post${creator ? ` by @${creator}` : ''}.
Caption: "${captionSnippet}"

Full text: ${params.captionText}

Create a useful note from this Instagram content.`
            }
          ]
    }
  ]

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 400,
    temperature: 0.3,
    messages
  })

  const analysis = response.choices[0]?.message?.content?.trim() || ''
  const creatorLine = creator ? `\n*By:* @${creator}` : ''

  return `📱 *Instagram content saved!*${creatorLine}\n\n${analysis}\n\n✅ Saved to *my notes*.\nSay *my saved reels* to see all saved posts.`
}
