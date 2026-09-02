import { addToList } from '@/lib/lists'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  armPendingAssetSave,
  isExplicitAssetSaveCommand,
  saveRecentMediaAsAsset,
} from '@/lib/services/asset-memory'

function extractSaveTitle(text: string) {
  return (text || '')
    .replace(/^save\s+it\s+as\s+/i, '')
    .replace(/^save\s+this\s+as\s+/i, '')
    .replace(/^save\s+that\s+as\s+/i, '')
    .replace(/^remember\s+it\s+as\s+/i, '')
    .replace(/^remember\s+this\s+as\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isLegacySaveLastContextCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower.startsWith('save it as ') ||
    lower.startsWith('save this as ') ||
    lower.startsWith('save that as ') ||
    lower.startsWith('remember it as ') ||
    lower.startsWith('remember this as ')
  )
}

export function isSaveLastContextCommand(text: string) {
  return isExplicitAssetSaveCommand(text) || isLegacySaveLastContextCommand(text)
}

function extractUrl(text: string) {
  const match = (text || '').match(/https?:\/\/[^\s]+/i)
  return match?.[0] || null
}

function cleanTitle(title: string) {
  return title
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isSaveCommandText(text: string) {
  return isLegacySaveLastContextCommand(text) || isExplicitAssetSaveCommand(text)
}

function looksLikeBotFallback(content: string) {
  const lower = (content || '').toLowerCase()
  return (
    lower.includes("i can't directly view instagram") ||
    lower.includes('cannot directly view instagram') ||
    lower.includes("i can see you've shared an instagram reel link") ||
    lower.includes('bangalore weather') ||
    lower.includes('partly cloudy')
  )
}

export async function buildSaveLastContextReply(params: {
  telegramId: number
  text: string
}) {
  // Asset-memory Pass 2: first try to bind the command to the exact preceding
  // media SID. If none exists (or it is stale), arm a one-next-media intent.
  // Generic “save this as Claude counter” remains the old text/link workflow.
  if (isExplicitAssetSaveCommand(params.text)) {
    const recentMedia = await saveRecentMediaAsAsset(params.telegramId, params.text)
    if (recentMedia) return recentMedia.reply

    await armPendingAssetSave(params.telegramId, params.text)
    return (
      `📎 Send the image, screenshot, PDF or document you want me to save.\n\n` +
      `I'll use the *next file only* and file it with this request.`
    )
  }

  const title = cleanTitle(extractSaveTitle(params.text))
  if (!title) {
    return `What name should I save it as?\n\nExample:\n*Save it as Claude counter*`
  }

  const { data: recent } = await supabaseAdmin
    .from('conversations')
    .select('role, content, created_at')
    .eq('telegram_id', params.telegramId)
    .order('created_at', { ascending: false })
    .limit(30)

  const lastUserItem = (recent || []).find((row: any) => {
    const content = String(row.content || '').trim()
    if (!content) return false
    if (row.role !== 'user') return false
    if (isSaveCommandText(content)) return false
    if (looksLikeBotFallback(content)) return false
    return true
  })

  if (!lastUserItem?.content) {
    return `I couldn’t find what to save.\n\nSend the link/text again, then say:\n*Save it as ${title}*`
  }

  const original = String(lastUserItem.content || '').trim()
  const url = extractUrl(original)
  const note = url ? `${title}\nLink: ${url}` : `${title}\n${original}`

  await addToList(params.telegramId, 'notes', [note])

  return (
    `✅ *Saved to notes*\n\n` +
    `*${title}*` +
    (url ? `\n${url}` : `\n${original.slice(0, 250)}`) +
    `\n\nType *my notes* to see it.`
  )
}
