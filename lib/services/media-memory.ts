/**
 * Media Memory Service
 * Saves social media content to platform-specific memory buckets.
 * Retrieval: "my instagram saves", "my youtube notes", "find reel about X"
 */

import Anthropic from '@anthropic-ai/sdk'
import { addToList, getList, type ListItem } from '@/lib/lists'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export type MediaPlatform = 'instagram' | 'facebook' | 'youtube' | 'linkedin' | 'twitter' | 'tiktok' | 'other'

export interface MediaMemoryItem {
  platform: MediaPlatform
  title: string
  creator: string
  summary: string
  tags: string[]
  source_text: string   // raw caption/hashtags
  saved_at: string
  has_transcript: boolean
}

// ── Platform bucket names ─────────────────────────────────────────────────────

export function getPlatformBucket(platform: MediaPlatform): string {
  const buckets: Record<MediaPlatform, string> = {
    instagram: 'instagram_saves',
    facebook:  'facebook_saves',
    youtube:   'youtube_saves',
    linkedin:  'linkedin_saves',
    twitter:   'twitter_saves',
    tiktok:    'tiktok_saves',
    other:     'social_saves',
  }
  return buckets[platform]
}

export function detectPlatformFromText(bodyText: string, mediaUrl?: string): MediaPlatform {
  const t = (bodyText || '').toLowerCase()
  const u = (mediaUrl || '').toLowerCase()
  if (/instagram\.com|instagram reel|#reel\b/i.test(t + u)) return 'instagram'
  if (/facebook\.com|fb\.watch|fb reel/i.test(t + u)) return 'facebook'
  if (/youtube\.com|youtu\.be|youtube video/i.test(t + u)) return 'youtube'
  if (/linkedin\.com|on linkedin/i.test(t + u)) return 'linkedin'
  if (/twitter\.com|x\.com|tweet/i.test(t + u)) return 'twitter'
  if (/tiktok\.com/i.test(t + u)) return 'tiktok'
  // Hashtag-heavy posts with image = likely Instagram/LinkedIn
  const hashCount = (bodyText.match(/#\w+/g) || []).length
  if (hashCount >= 3) return 'instagram'
  if (hashCount >= 1 && /\b(d2c|startup|venture|funding|b2b|saas|ceo|founder)/i.test(bodyText)) return 'linkedin'
  return 'other'
}

// ── YouTube transcript fetcher ────────────────────────────────────────────────

export async function fetchYouTubeTranscript(url: string): Promise<string | null> {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript')
    const videoId = extractYouTubeId(url)
    if (!videoId) return null

    const segments = await YoutubeTranscript.fetchTranscript(videoId)
    if (!segments?.length) return null

    const text = segments.map((s: { text: string }) => s.text).join(' ')
    return text.slice(0, 8000)
  } catch (err) {
    console.log('[media-memory] YouTube transcript not available:', err)
    return null
  }
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

// ── YouTube oEmbed metadata ───────────────────────────────────────────────────

async function fetchYouTubeMeta(url: string): Promise<{ title: string; author: string } | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    if (!r.ok) return null
    const d = await r.json()
    return { title: d.title || '', author: d.author_name || '' }
  } catch { return null }
}

// ── AI summarizer ─────────────────────────────────────────────────────────────

async function summarizeMediaContent(params: {
  platform: MediaPlatform
  caption: string
  creator: string
  transcript?: string
  thumbnailBase64?: string
}): Promise<{ title: string; summary: string; tags: string[] }> {
  const platformLabel = {
    instagram: 'Instagram reel',
    facebook: 'Facebook reel',
    youtube: 'YouTube video',
    linkedin: 'LinkedIn post',
    twitter: 'Tweet/X post',
    tiktok: 'TikTok video',
    other: 'Social media post',
  }[params.platform]

  const hasContent = params.transcript || params.caption

  if (!hasContent && !params.thumbnailBase64) {
    return { title: 'Saved content', summary: 'No content could be extracted.', tags: [] }
  }

  const contentBlock = params.transcript
    ? `Full transcript:\n${params.transcript.slice(0, 4000)}`
    : `Caption/text: ${params.caption}`

  const prompt = `You are saving a ${platformLabel}${params.creator ? ` by ${params.creator}` : ''} to someone's long-term memory on WhatsApp.

${contentBlock}

Return ONLY valid JSON, no markdown:
{
  "title": "Short descriptive title (max 8 words)",
  "summary": "2-3 sentence summary of what this content is about and why it's worth saving",
  "tags": ["tag1", "tag2", "tag3"]
}

Tags should be 1-2 word topic labels (e.g. "marketing", "d2c", "fundraising", "fitness", "recipe").`

  const content: Anthropic.MessageParam['content'] = []

  if (params.thumbnailBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: params.thumbnailBase64 },
    })
  }

  content.push({ type: 'text', text: prompt })

  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    messages: [{ role: 'user', content }],
  })

  const text = result.content[0]?.type === 'text' ? result.content[0].text.trim() : ''
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    const parsed = JSON.parse(clean)
    return {
      title: parsed.title || 'Saved content',
      summary: parsed.summary || params.caption.slice(0, 150),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
    }
  } catch {
    return { title: 'Saved content', summary: params.caption.slice(0, 150), tags: [] }
  }
}

// ── Main save function ────────────────────────────────────────────────────────

export async function saveMediaMemory(params: {
  telegramId: number
  platform: MediaPlatform
  bodyText: string
  mediaUrl?: string       // Twilio media URL for thumbnail
  accountSid?: string
  authToken?: string
  detectedUrl?: string    // URL found in body text (for YouTube etc)
  creator?: string
}): Promise<{ reply: string; item: MediaMemoryItem }> {
  const { telegramId, platform, bodyText } = params

  let transcript: string | undefined
  let thumbnailBase64: string | undefined
  let creator = params.creator || ''
  let caption = bodyText
    .replace(/https?:\/\/\S+/g, '')
    .replace(/linkedin\.com\s*/gi, '')
    .trim()

  // YouTube: fetch transcript + metadata
  if (platform === 'youtube' && params.detectedUrl) {
    console.log('[media-memory] Fetching YouTube transcript for:', params.detectedUrl)
    const [meta, tx] = await Promise.all([
      fetchYouTubeMeta(params.detectedUrl),
      fetchYouTubeTranscript(params.detectedUrl),
    ])
    if (meta?.title) caption = meta.title + (caption ? ' — ' + caption : '')
    if (meta?.author) creator = meta.author
    if (tx) {
      transcript = tx
      console.log('[media-memory] Got transcript, length:', tx.length)
    } else {
      console.log('[media-memory] No transcript available, using metadata only')
    }
  }

  // Fetch thumbnail from Twilio for vision analysis
  if (params.mediaUrl && params.accountSid && params.authToken) {
    try {
      const r = await fetch(params.mediaUrl, {
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${params.accountSid}:${params.authToken}`).toString('base64'),
        },
      })
      if (r.ok) {
        const buf = await r.arrayBuffer()
        thumbnailBase64 = Buffer.from(buf).toString('base64')
      }
    } catch { /* thumbnail optional */ }
  }

  // Summarize
  const { title, summary, tags } = await summarizeMediaContent({
    platform,
    caption,
    creator,
    transcript,
    thumbnailBase64,
  })

  // Build memory item
  const item: MediaMemoryItem = {
    platform,
    title,
    creator,
    summary,
    tags,
    source_text: bodyText.slice(0, 300),
    saved_at: new Date().toISOString(),
    has_transcript: !!transcript,
  }

  // Save to platform bucket + notes (for unified search)
  const bucket = getPlatformBucket(platform)
  const noteText = `[${platform.toUpperCase()}] ${title}${creator ? ' — by ' + creator : ''}\n${summary}\nTags: ${tags.join(', ')}`

  await Promise.all([
    addToList(telegramId, bucket, [JSON.stringify(item)]),
    addToList(telegramId, 'notes', [noteText]),
  ])

  // Build WhatsApp reply
  const platformEmoji: Record<MediaPlatform, string> = {
    instagram: '📸',
    facebook: '👥',
    youtube: '▶️',
    linkedin: '💼',
    twitter: '🐦',
    tiktok: '🎵',
    other: '🔗',
  }

  const emoji = platformEmoji[platform]
  const transcriptBadge = transcript ? '\n✍️ *Full transcript saved*' : ''
  const creatorLine = creator ? `\n*By:* ${creator}` : ''
  const tagsLine = tags.length ? `\n🏷️ ${tags.map(t => '#' + t).join(' ')}` : ''

  const reply =
    `${emoji} *${getPlatformDisplayName(platform)} saved!*${creatorLine}\n\n` +
    `*${title}*\n${summary}${transcriptBadge}${tagsLine}\n\n` +
    `✅ Saved to *my ${platform} saves*.\n` +
    `Say _my ${platform} saves_ to find it later.`

  return { reply, item }
}

function getPlatformDisplayName(p: MediaPlatform): string {
  return {
    instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube',
    linkedin: 'LinkedIn', twitter: 'Twitter/X', tiktok: 'TikTok', other: 'Content',
  }[p]
}

// ── Retrieval handler ─────────────────────────────────────────────────────────

export function isMediaMemoryCommand(text: string): boolean {
  const lower = (text || '').toLowerCase().trim()
  return (
    /^my (instagram|facebook|youtube|linkedin|twitter|tiktok|social) (saves|notes|reels|videos|posts)$/i.test(lower) ||
    /^(instagram|facebook|youtube|linkedin|twitter|tiktok) (saves|memory|notes|reels|videos|posts)$/i.test(lower) ||
    /^find (reel|video|post|content) (about|on) .+/i.test(lower) ||
    /^search (instagram|facebook|youtube|linkedin|twitter|tiktok|my saves|my reels)/i.test(lower) ||
    lower === 'my saves' ||
    lower === 'my social saves' ||
    lower === 'my reels' ||
    lower === 'my videos'
  )
}

export async function buildMediaMemoryReply(telegramId: number, text: string): Promise<string> {
  const lower = text.toLowerCase().trim()

  // Detect which platform they're asking about
  const platformMatch = lower.match(/(instagram|facebook|youtube|linkedin|twitter|tiktok)/)
  const platform = platformMatch?.[1] as MediaPlatform | undefined

  // Search query
  const searchMatch = lower.match(/find (?:reel|video|post|content) (?:about|on) (.+)/i)
  const searchQuery = searchMatch?.[1]?.trim()

  if (searchQuery) {
    return await searchMediaMemory(telegramId, searchQuery)
  }

  if (platform) {
    return await listPlatformSaves(telegramId, platform)
  }

  // "my saves" — show summary across all platforms
  return await listAllSaves(telegramId)
}

async function listPlatformSaves(telegramId: number, platform: MediaPlatform): Promise<string> {
  const bucket = getPlatformBucket(platform)
  const list = await getList(telegramId, bucket)
  const items = (list?.items || []) as ListItem[]

  if (!items.length) {
    return `📭 No ${getPlatformDisplayName(platform)} saves yet.\n\nForward any ${getPlatformDisplayName(platform)} post or reel to me and I'll save it here!`
  }

  const emoji = { instagram: '📸', facebook: '👥', youtube: '▶️', linkedin: '💼', twitter: '🐦', tiktok: '🎵', other: '🔗' }[platform]
  const recent = items.slice(-10).reverse()

  const lines = recent.map((item, i) => {
    try {
      const m: MediaMemoryItem = JSON.parse(item.text)
      const date = new Date(m.saved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      const tx = m.has_transcript ? ' ✍️' : ''
      return `${i + 1}. *${m.title}*${tx}\n   ${m.summary.slice(0, 80)}...\n   _${date}${m.creator ? ' · ' + m.creator : ''}_`
    } catch {
      return `${i + 1}. ${item.text.slice(0, 100)}`
    }
  })

  return (
    `${emoji} *Your ${getPlatformDisplayName(platform)} saves* (${items.length} total)\n\n` +
    lines.join('\n\n') +
    `\n\n_Say *find reel about [topic]* to search across all saves_`
  )
}

async function listAllSaves(telegramId: number): Promise<string> {
  const platforms: MediaPlatform[] = ['instagram', 'facebook', 'youtube', 'linkedin', 'twitter', 'tiktok']
  const counts: string[] = []

  for (const p of platforms) {
    const list = await getList(telegramId, getPlatformBucket(p))
    const count = list?.items?.length || 0
    if (count > 0) {
      const emoji = { instagram: '📸', facebook: '👥', youtube: '▶️', linkedin: '💼', twitter: '🐦', tiktok: '🎵', other: '🔗' }[p]
      counts.push(`${emoji} *${getPlatformDisplayName(p)}:* ${count} saved`)
    }
  }

  if (!counts.length) {
    return `📭 *Your media saves*\n\nNothing saved yet!\n\nForward any Instagram reel, YouTube video, or LinkedIn post to me — I'll save a summary with long-term memory.\n\nTry it now: forward a YouTube video link!`
  }

  return (
    `🗂️ *Your media memory*\n\n` +
    counts.join('\n') +
    `\n\nSay:\n• _my instagram saves_ — see recent IG saves\n• _my youtube saves_ — transcribed videos\n• _find reel about marketing_ — search across all`
  )
}

async function searchMediaMemory(telegramId: number, query: string): Promise<string> {
  const platforms: MediaPlatform[] = ['instagram', 'facebook', 'youtube', 'linkedin', 'twitter', 'tiktok', 'other']
  const matches: Array<{ item: MediaMemoryItem; platform: MediaPlatform }> = []

  for (const p of platforms) {
    const list = await getList(telegramId, getPlatformBucket(p))
    const items = (list?.items || []) as ListItem[]
    for (const item of items) {
      try {
        const m: MediaMemoryItem = JSON.parse(item.text)
        const searchable = `${m.title} ${m.summary} ${m.tags.join(' ')} ${m.source_text}`.toLowerCase()
        if (searchable.includes(query.toLowerCase())) {
          matches.push({ item: m, platform: p })
        }
      } catch { /* skip */ }
    }
  }

  if (!matches.length) {
    return `🔍 No saves found for *"${query}"*.\n\nTry a different keyword, or say *my saves* to browse all.`
  }

  const emoji: Record<MediaPlatform, string> = { instagram: '📸', facebook: '👥', youtube: '▶️', linkedin: '💼', twitter: '🐦', tiktok: '🎵', other: '🔗' }

  const lines = matches.slice(0, 8).map((m, i) => {
    const date = new Date(m.item.saved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    return `${i + 1}. ${emoji[m.platform]} *${m.item.title}*\n   ${m.item.summary.slice(0, 90)}...\n   _${date}${m.item.creator ? ' · ' + m.item.creator : ''}_`
  })

  return (
    `🔍 *Found ${matches.length} result${matches.length === 1 ? '' : 's'} for "${query}"*\n\n` +
    lines.join('\n\n')
  )
}
