import OpenAI from 'openai'

export type ContentPlatform = 'instagram' | 'youtube' | 'tiktok' | 'linkedin' | 'other'

export type ReelSaveResult = {
  url: string
  platform: ContentPlatform
  title: string
  author: string
  summary: string
  savedNote: string
}

// ── URL Detection ─────────────────────────────────────────────────────────────

export function detectReelUrl(text: string): string | null {
  const patterns = [
    // Instagram — include full URL with query params
    /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[^\s]+/i,
    /https?:\/\/(?:www\.)?instagram\.com\/stories\/[^\s]+/i,
    // YouTube
    /https?:\/\/youtu\.be\/[^\s]+/i,
    /https?:\/\/(?:www\.)?youtube\.com\/(?:shorts|watch)[^\s]+/i,
    // TikTok
    /https?:\/\/(?:vm\.)?tiktok\.com\/[^\s]+/i,
    /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s\/]+\/video\/[^\s]+/i,
    // LinkedIn posts & articles
    /https?:\/\/(?:www\.)?linkedin\.com\/(?:posts|feed\/update|pulse|in\/[^\s\/]+\/recent-activity\/shares)\/[^\s]+/i,
    /https?:\/\/(?:www\.)?linkedin\.com\/posts\/[^\s]+/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[0].replace(/[.,;!?]+$/, '') // strip trailing punctuation
  }
  return null
}

export function detectPlatform(url: string): ContentPlatform {
  if (/instagram\.com/i.test(url)) return 'instagram'
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube'
  if (/tiktok\.com/i.test(url)) return 'tiktok'
  if (/linkedin\.com/i.test(url)) return 'linkedin'
  return 'other'
}

// ── Card Preview Detection ────────────────────────────────────────────────────

export function detectInstagramPreviewCard(text: string): boolean {
  const t = (text || '').trim()
  // Only trigger if text contains 'on Instagram:' pattern (WhatsApp link preview format)
  // and does NOT already contain a full URL (handled by detectReelUrl)
  const hasFullUrl = /https?:\/\//i.test(t)
  if (hasFullUrl) return false // Let detectReelUrl handle it
  return (
    /on instagram:\s*["""]/i.test(t) ||
    (/instagram/i.test(t) && t.length > 10 && !hasFullUrl)
  )
}

export function detectLinkedInPreviewCard(text: string): boolean {
  const t = (text || '').trim()
  const hasFullUrl = /https?:\/\//i.test(t)
  if (hasFullUrl) return false
  return /on linkedin|linkedin\.com|linkedin post/i.test(t)
}

// ── Context Parsing ───────────────────────────────────────────────────────────

export function parseWhatsAppBodyContext(bodyText: string): { creator: string; caption: string } {
  if (!bodyText) return { creator: '', caption: '' }

  // Strip URLs and bare domain references (linkedin.com, instagram.com)
  const cleanText = bodyText
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\/\?\S+/g, '')
    .replace(/^[ \t]*(linkedin|instagram|youtube|tiktok)\.com[ \t]*$/im, '')
    .trim()

  // Format 1: "Name on Instagram/LinkedIn: caption"
  const onPlatform = cleanText.match(/^(.+?)\s+on\s+(?:instagram|linkedin)[^:]*:\s*[\u201c"\u201d"]?([\s\S]+?)[\u201c"\u201d"]?\s*$/i)
  if (onPlatform) {
    return { creator: onPlatform[1].trim(), caption: onPlatform[2].trim().slice(0, 200) }
  }

  // Format 2: LinkedIn article card — title + excerpt, no "on linkedin:" prefix
  // e.g. "Anthropic just launched Claude for Small Business, and it basically..."
  const lineArr = cleanText.split('\n').map((l: string) => l.trim()).filter(Boolean)
  if (lineArr.length > 0) {
    const title = lineArr[0]
    const excerpt = lineArr.slice(1, 3).join(' ')
    const caption = excerpt ? title + ' — ' + excerpt : title
    return { creator: '', caption: caption.slice(0, 200) }
  }

  return { creator: '', caption: cleanText.slice(0, 200).trim() }
}

// ── oEmbed Fetchers ───────────────────────────────────────────────────────────

async function fetchYouTubeMeta(url: string): Promise<{ title: string; author: string } | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    if (!r.ok) return null
    const d = await r.json()
    return { title: d.title || '', author: d.author_name || '' }
  } catch { return null }
}

// ── AI Summary ────────────────────────────────────────────────────────────────

async function buildContentNote(params: {
  url: string
  platform: ContentPlatform
  creator: string
  caption: string
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return params.caption || ''

  const openai = new OpenAI({ apiKey })

  const platformLabel = {
    instagram: 'Instagram reel',
    youtube: 'YouTube video',
    tiktok: 'TikTok video',
    linkedin: 'LinkedIn post',
    other: 'social media post',
  }[params.platform]

  const contextParts = [
    params.creator ? `Creator: ${params.creator}` : null,
    params.caption ? `Caption: "${params.caption}"` : null,
    `Platform: ${platformLabel}`,
  ].filter(Boolean).join('\n')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 120,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: `You write short useful notes about saved social media content. 
Use ONLY the creator name and caption text provided — never invent content.
If caption is truncated (ends with "..."), note it is truncated and describe what you can infer.
2-3 sentences max. No hashtags. No markdown. Plain text only.`
      },
      {
        role: 'user',
        content: `Write a note for this saved ${platformLabel}:\n\n${contextParts}`
      }
    ]
  })

  return response.choices[0]?.message?.content?.trim() || params.caption || ''
}

// ── Main saveReel function ────────────────────────────────────────────────────

export async function saveReel(params: {
  url: string
  userCaption?: string
}): Promise<ReelSaveResult> {
  const platform = detectPlatform(params.url)
  let title = ''
  let author = ''

  // Try oEmbed for YouTube (Instagram oEmbed needs FB token, skip)
  if (platform === 'youtube') {
    const meta = await fetchYouTubeMeta(params.url).catch(() => null)
    title = meta?.title || ''
    author = meta?.author || ''
  }

  // Parse creator + caption from WhatsApp body text
  const parsed = parseWhatsAppBodyContext(params.userCaption || '')
  const creator = parsed.creator || author || ''
  const caption = parsed.caption || title || ''

  // Build AI summary
  const summary = await buildContentNote({
    url: params.url,
    platform,
    creator,
    caption,
  }).catch(() => caption || '')

  // Format output
  const platformLabels: Record<ContentPlatform, string> = {
    instagram: '📱 Instagram',
    youtube: '▶️ YouTube',
    tiktok: '🎵 TikTok',
    linkedin: '💼 LinkedIn',
    other: '🔗 Social',
  }
  const label = platformLabels[platform]

  const creatorLine = creator ? `\n*By:* ${creator}` : ''
  const captionIsJunk = !caption || caption.startsWith('/?') || caption.startsWith('?igsh') || caption.length < 4
  const captionLine = captionIsJunk ? '' : `\n*"${caption.slice(0, 100)}${caption.length > 100 ? '...' : ''}"*`

  const savedNote = `${label} saved!${creatorLine}${captionLine}\n\n${summary}\n\n✅ Saved to *my notes*.\nSay *my notes* to find it later.`

  return { url: params.url, platform, title: caption, author: creator, summary, savedNote }
}

// ── Thumbnail analyser (for when WhatsApp sends image with link preview) ──────

export function isInstagramReelPreview(bodyText: string): boolean {
  return detectInstagramPreviewCard(bodyText) || detectLinkedInPreviewCard(bodyText)
}

export async function analyseInstagramThumbnail(params: {
  mediaUrl: string
  contentType: string
  captionText: string
}): Promise<string> {
  const OpenAI_mod = (await import('openai')).default
  const openai = new OpenAI_mod({ apiKey: process.env.OPENAI_API_KEY })

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
    } catch { /* fall through */ }
  }

  const parsed = parseWhatsAppBodyContext(params.captionText)
  const creator = parsed.creator
  const caption = parsed.caption

  const isLinkedIn = /linkedin/i.test(params.captionText)
  const platformLabel = isLinkedIn ? 'LinkedIn post' : 'Instagram reel'

  const messages: any[] = [{
    role: 'system',
    content: `You create useful notes from ${platformLabel} thumbnails and captions shared on WhatsApp. Be specific about what you see/can infer. Under 150 words. Format for WhatsApp.`
  }, {
    role: 'user',
    content: imageDataUrl
      ? [
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
          { type: 'text', text: `${platformLabel} by ${creator || 'unknown creator'}.\nCaption: "${caption}"\n\nDescribe what this content is about and why someone would save it.` }
        ]
      : [{ type: 'text', text: `${platformLabel} by ${creator || 'unknown creator'}.\nCaption: "${caption}"\n\nCreate a useful note about this content.` }]
  }]

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 300,
    temperature: 0.3,
    messages
  })

  const analysis = response.choices[0]?.message?.content?.trim() || ''
  const platformEmoji = isLinkedIn ? '💼' : '📱'
  const platformName = isLinkedIn ? 'LinkedIn' : 'Instagram'
  const creatorLine = creator ? `\n*By:* ${creator}` : ''

  return `${platformEmoji} *${platformName} content saved!*${creatorLine}\n\n${analysis}\n\n✅ Saved to *my notes*.`
}
