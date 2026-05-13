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
