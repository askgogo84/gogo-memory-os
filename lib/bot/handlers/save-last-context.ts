import { addToList } from '@/lib/lists'
import { supabaseAdmin } from '@/lib/supabase-admin'

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

export function isSaveLastContextCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    lower.startsWith('save it as ') ||
    lower.startsWith('save this as ') ||
    lower.startsWith('save that as ') ||
    lower.startsWith('remember it as ') ||
    lower.startsWith('remember this as ')
  )
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
  const lower = (text || '').toLowerCase().trim()
  return (
    lower.startsWith('save it as ') ||
    lower.startsWith('save this as ') ||
    lower.startsWith('save that as ') ||
    lower.startsWith('remember it as ') ||
    lower.startsWith('remember this as ')
  )
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

  const note = url
    ? `${title}\nLink: ${url}`
    : `${title}\n${original}`

  await addToList(params.telegramId, 'notes', [note])

  return (
    `✅ *Saved to notes*\n\n` +
    `*${title}*` +
    (url ? `\n${url}` : `\n${original.slice(0, 250)}`) +
    `\n\nType *my notes* to see it.`
  )
}
