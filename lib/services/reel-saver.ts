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
  // WhatsApp truncates platform names in link preview cards (e.g. "Instagra..." or "instagr")
  // Match full and truncated platform names
  const hasFullUrl = /https?:\/\//i.test(t)
  if (hasFullUrl) return false // Let detectReelUrl handle it
  return (
    /on instagr/i.test(t) ||   // catches "Instagram", "Instagra...", "Instagram:"
    /instagram\.com/i.test(t) ||
    (/instagram/i.test(t) && t.length > 10 && !hasFullUrl)
  )
}

export function detectLinkedInPreviewCard(text: string): boolean {
  const t = (text || '').trim()
  const hasFullUrl = /https?:\/\//i.test(t)
  if (hasFullUrl) return false
  // Classic: body contains "linkedin.com" or "on linkedin"
  if (/on linkedin|linkedin\.com|linkedin post/i.test(t)) return true
  // WhatsApp LinkedIn share: body is hashtags + description (no URL in body text)
  // Detect: 2+ hashtags AND has real text content alongside them
  const hashtagCount = (t.match(/#\w+/g) || []).length
  const textWithoutHashtags = t.replace(/#\w+/g, '').trim()
  if (hashtagCount >= 2 && textWithoutHashtags.length > 20) return true
  return false
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

  // Format 2: Hashtag-style LinkedIn post (e.g. #d2cinsider #vcfund\nD2C Insider is set to launch...)
  const lineArr = cleanText.split('\n').map((l: string) => l.trim()).filter(Boolean)
  const firstLineIsHashtags = lineArr.length > 0 && /^(#\w+\s*)+$/.test(lineArr[0])
  if (firstLineIsHashtags && lineArr.length > 1) {
    // Use the description lines as caption, hashtags as context
    const description = lineArr.slice(1).join(' ')
    const hashtags = lineArr[0]
    return { creator: '', caption: `${description} ${hashtags}`.slice(0, 200) }
  }

  // Format 3: LinkedIn article card — title + excerpt, no "on linkedin:" prefix
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
Use the creator name and caption provided. If caption is truncated or short, infer the topic from context.
Always write something useful — never say you cannot write a note.
2-3 sentences max. No hashtags. No markdown. Plain text only.`
      },
      {
        role: 'user',
        content: `Write a note for this saved ${platformLabel}:\n\n${contextParts || 'No caption available — write a generic save note.'}`
      }
    ]
  })

  const gptNote = response.choices[0]?.message?.content?.trim() || ''
  // Reject GPT output that asks for more info
  if (/please provide|provide the|creator name|need more|caption for/i.test(gptNote)) {
    return params.caption || \ by \ saved for later.  }
  return gptNote || params.caption || ''
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
  const captionIsJunk = !caption || caption.startsWith('/?') || caption.startsWith('?igsh') || caption.replace(/\.\.\.$/,'').trim().length < 3
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
  // Use parsed caption, fallback to raw captionText stripped of URLs
  const rawCaption = params.captionText
    .replace(/https?:\/\/\S+/g, '')
    .replace(/linkedin\.com\s*/gi, '')
    .trim()
  const caption = parsed.caption || rawCaption

  console.log('[reel-saver] captionText:', params.captionText.slice(0, 200))
  console.log('[reel-saver] parsed caption:', caption.slice(0, 200))

  // Detect LinkedIn: either "linkedin" in text, OR hashtag-style post (2+ hashtags)
  const hashtagCount2 = (params.captionText.match(/#\w+/g) || []).length
  const isLinkedIn = /linkedin/i.test(params.captionText) || hashtagCount2 >= 2
  const platformLabel = isLinkedIn ? 'LinkedIn post' : 'Instagram reel'

  const captionForPrompt = caption || '(no caption — use image to describe the content)'

  const messages: any[] = [{
    role: 'system',
    content: `You create useful notes from ${platformLabel} thumbnails and captions shared on WhatsApp. Be specific and concise. Under 100 words. Plain text only, no markdown.`
  }, {
    role: 'user',
    content: imageDataUrl
      ? [
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
          { type: 'text', text: `${platformLabel}${creator ? ' by ' + creator : ''}.\nContext: "${captionForPrompt}"\n\nWhat is this about? Write a useful 2-3 sentence note for someone who saved this.` }
        ]
      : [{ type: 'text', text: `${platformLabel}${creator ? ' by ' + creator : ''}.\nContext: "${captionForPrompt}"\n\nWrite a useful 2-3 sentence note for someone who saved this.` }]
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

