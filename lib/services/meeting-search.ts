/**
 * Meeting Search & Intelligence
 * - Cross-meeting semantic search using Claude
 * - Open action items tracker
 * - "What's pending" across all meetings
 */

import Anthropic from '@anthropic-ai/sdk'
import { getList, type ListItem } from '@/lib/lists'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── Types ────────────────────────────────────────────────────────────────────

interface MeetingNote {
  text: string
  added_at: string
  index: number
}

// ── Load all meeting notes for a user ────────────────────────────────────────

async function getMeetingNotes(telegramId: number): Promise<MeetingNote[]> {
  const list = await getList(telegramId, 'meeting_notes')
  const items = (list?.items || []) as ListItem[]
  return items.map((item, i) => {
    // Items are stored as JSON: { summary, transcript, language, speakers, saved_at }
    // or as plain text (legacy)
    let text = item.text || ''
    try {
      const parsed = JSON.parse(text)
      if (parsed.summary || parsed.transcript) {
        // Combine summary + transcript for rich search
        text = [parsed.summary, parsed.transcript].filter(Boolean).join('\n\n--- FULL TRANSCRIPT ---\n\n')
      }
    } catch { /* legacy plain text format */ }
    return { text, added_at: item.added_at, index: i }
  })
}

// ── Cross-meeting search using Claude ────────────────────────────────────────

export async function searchMeetingNotes(telegramId: number, query: string): Promise<string> {
  const notes = await getMeetingNotes(telegramId)

  if (!notes.length) {
    return `🔍 No meeting notes found.\n\nSend me a voice note of your next meeting to start building your meeting memory.`
  }

  // Build context for Claude — all meeting notes with dates
  const context = notes.map((n, i) => {
    const date = new Date(n.added_at).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
    return `--- Meeting ${i + 1} (${date}) ---\n${n.text.slice(0, 800)}`
  }).join('\n\n')

  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `You are searching a person's meeting notes history. Answer their question based ONLY on what's in these notes. Be specific — include names, dates, decisions. If not found, say so clearly. Format for WhatsApp (bold with *, no markdown).

QUERY: "${query}"

MEETING NOTES:
${context.slice(0, 12000)}

Answer the query concisely (max 150 words). Include which meeting it came from (Meeting 1, Meeting 3, etc.) and the date.`,
    }],
  })

  const answer = result.content[0]?.type === 'text' ? result.content[0].text.trim() : 'Could not search notes.'

  return `🔍 *Search: "${query}"*\n\n${answer}\n\n_Say *what's pending* to see all open action items_`
}

// ── Open action items tracker ─────────────────────────────────────────────────

export async function getOpenActionItems(telegramId: number): Promise<string> {
  const notes = await getMeetingNotes(telegramId)

  if (!notes.length) {
    return `📋 No meeting notes yet.\n\nSend me a voice note of your next meeting and I'll track all action items automatically.`
  }

  // Use only recent notes (last 15) to keep context manageable
  const recentNotes = notes.slice(-15)

  const context = recentNotes.map((n, i) => {
    const date = new Date(n.added_at).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short',
    })
    return `--- Meeting ${i + 1} (${date}) ---\n${n.text.slice(0, 600)}`
  }).join('\n\n')

  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 700,
    messages: [{
      role: 'user',
      content: `You are reviewing someone's recent meeting notes to find ALL open/unresolved action items.

Extract every action item that sounds incomplete or pending. Group by person if owner is mentioned. For each item include which meeting it came from and the date.

Format for WhatsApp:
*Open action items*

*You*
1. Action item — _from Meeting X, Date_
2. Action item — _from Meeting X, Date_

*Srinivas* (or other names)
1. Action item — _from Meeting X, Date_

If all items seem resolved, say so.

MEETING NOTES:
${context.slice(0, 10000)}`,
    }],
  })

  const answer = result.content[0]?.type === 'text' ? result.content[0].text.trim() : 'Could not extract action items.'

  return (
    `📋 *What's pending across your meetings*\n\n${answer}\n\n` +
    `_Say *search meetings [topic]* to find specific discussions_`
  )
}

// ── Meeting summary digest ────────────────────────────────────────────────────

export async function getWeeklyMeetingDigest(telegramId: number): Promise<string> {
  const notes = await getMeetingNotes(telegramId)

  // Get notes from last 7 days
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const recentNotes = notes.filter(n => new Date(n.added_at) > oneWeekAgo)

  if (!recentNotes.length) {
    return `📅 *This week's meetings*\n\nNo meetings recorded this week.\n\nSend a voice note of your next meeting to start tracking.`
  }

  const context = recentNotes.map((n, i) => {
    const date = new Date(n.added_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    return `--- ${date} ---\n${n.text.slice(0, 500)}`
  }).join('\n\n')

  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Summarize this week's meetings in a concise digest for WhatsApp. Include: key decisions made, who committed to what, and what's still open. Be specific with names and items. Max 200 words.

${context.slice(0, 8000)}`,
    }],
  })

  const digest = result.content[0]?.type === 'text' ? result.content[0].text.trim() : ''

  return (
    `📅 *This week's meeting digest*\n_(${recentNotes.length} meeting${recentNotes.length === 1 ? '' : 's'})_\n\n` +
    `${digest}\n\n` +
    `_Say *what's pending* for all open action items_`
  )
}

// ── Command detection ─────────────────────────────────────────────────────────

export function isMeetingSearchCommand(text: string): boolean {
  const lower = (text || '').toLowerCase().trim()
  return (
    /^search meetings?\s+.+/i.test(lower) ||
    /^find (in |from |across )?meetings?\s+.+/i.test(lower) ||
    /^what did (we|i) (discuss|decide|say|talk) about .+/i.test(lower) ||
    /^when did (we|i) (discuss|talk about|mention|decide) .+/i.test(lower) ||
    lower === "what's pending" ||
    lower === 'whats pending' ||
    lower === 'open action items' ||
    lower === 'pending actions' ||
    lower === 'what is pending' ||
    lower === 'my pending tasks' ||
    lower === 'meeting digest' ||
    lower === 'weekly meeting digest' ||
    lower === 'this week meetings'
  )
}

export async function buildMeetingSearchReply(telegramId: number, text: string): Promise<string> {
  const lower = text.toLowerCase().trim()

  // Open action items
  if (
    lower === "what's pending" ||
    lower === 'whats pending' ||
    lower === 'open action items' ||
    lower === 'pending actions' ||
    lower === 'what is pending' ||
    lower === 'my pending tasks'
  ) {
    return await getOpenActionItems(telegramId)
  }

  // Weekly digest
  if (lower === 'meeting digest' || lower === 'weekly meeting digest' || lower === 'this week meetings') {
    return await getWeeklyMeetingDigest(telegramId)
  }

  // Search query — extract the search term
  const searchMatch =
    text.match(/^search meetings?\s+(.+)/i) ||
    text.match(/^find (?:in |from |across )?meetings?\s+(.+)/i) ||
    text.match(/^what did (?:we|i) (?:discuss|decide|say|talk) about (.+)/i) ||
    text.match(/^when did (?:we|i) (?:discuss|talk about|mention|decide) (.+)/i)

  const query = searchMatch?.[1]?.trim() || text

  return await searchMeetingNotes(telegramId, query)
}
