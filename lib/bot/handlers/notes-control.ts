import { addToList, clearList, formatList, getList, type ListItem } from '@/lib/lists'
import { supabaseAdmin } from '@/lib/supabase-admin'

function cleanNoteText(text: string) {
  return (text || '')
    .replace(/^(add|save|create|write)\s+(a\s+)?note\s*(to|that|:)?\s*/i, '')
    .replace(/^note\s*(to|that|:)?\s*/i, '')
    .replace(/^remember\s+this\s*(as\s+a\s+note)?\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanLine(line: string) {
  return (line || '')
    .replace(/^[-•\d.)\s]+/, '')
    .replace(/^(Image note\s+—\s*)/i, '')
    .replace(/^Text:\s*/i, '')
    .replace(/^Action:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function shortText(text: string, max = 90) {
  const clean = cleanLine(text)
  return clean.length > max ? clean.slice(0, max - 3).trim() + '...' : clean
}

function extractNoteBullets(noteText: string) {
  return noteText
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
    .filter((line) => !/^summary$/i.test(line))
    .filter((line) => !/^extracted text$/i.test(line))
    .filter((line) => !/^next actions$/i.test(line))
    .filter((line) => !/^none$/i.test(line))
    .slice(0, 4)
}

function parseIndex(text: string) {
  const match = (text || '').match(/\b(\d+)\b/)
  if (!match) return null
  const index = Number(match[1]) - 1
  return Number.isFinite(index) && index >= 0 ? index : null
}

function wantsAddNote(lower: string) {
  return (
    lower.startsWith('add note') ||
    lower.startsWith('save note') ||
    lower.startsWith('create note') ||
    lower.startsWith('write note') ||
    lower.startsWith('note:') ||
    lower.startsWith('note to') ||
    lower.startsWith('note that')
  )
}

function wantsSummarizeNotes(lower: string) {
  return (
    lower === 'summarize notes' ||
    lower === 'summarise notes' ||
    lower === 'summarize my notes' ||
    lower === 'summarise my notes' ||
    lower === 'notes summary' ||
    lower === 'my notes summary' ||
    lower === 'summary of my notes'
  )
}

function wantsClearNotes(lower: string) {
  return lower === 'clear notes' || lower === 'delete all notes' || lower === 'clear my notes'
}

function wantsDeleteNote(lower: string) {
  return (
    /^delete note\s+\d+\b/i.test(lower) ||
    /^remove note\s+\d+\b/i.test(lower) ||
    /^clear note\s+\d+\b/i.test(lower)
  )
}

function wantsDoneNote(lower: string) {
  return /^done note\s+\d+\b/i.test(lower) || /^mark note\s+\d+\s+done\b/i.test(lower)
}

export function isNotesCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    lower === 'notes' ||
    lower === 'my notes' ||
    lower === 'show notes' ||
    lower === 'show my notes' ||
    lower === 'open notes' ||
    lower === 'view notes' ||
    lower === 'all notes' ||
    lower === 'my note' ||
    wantsAddNote(lower) ||
    wantsSummarizeNotes(lower) ||
    wantsClearNotes(lower) ||
    wantsDeleteNote(lower) ||
    wantsDoneNote(lower)
  )
}

async function updateNotesList(telegramId: number, items: ListItem[]) {
  const list = await getList(telegramId, 'notes')
  if (!list) return false

  const { error } = await supabaseAdmin
    .from('lists')
    .update({ items, updated_at: new Date().toISOString() })
    .eq('id', list.id)

  return !error
}

async function summarizeNotes(telegramId: number) {
  const notes = await getList(telegramId, 'notes')
  const items = ((notes?.items || []) as ListItem[]).filter((item) => !item.done)

  if (!items.length) {
    return `📝 *Notes summary*\n\nNo active notes to summarize.`
  }

  const bullets = items.flatMap((item) => extractNoteBullets(item.text)).slice(0, 12)
  const actions = bullets.filter((line) => /test|call|check|follow|send|prepare|review|ask|create|update|deploy|verify/i.test(line)).slice(0, 6)
  const themes = bullets.filter((line) => !actions.includes(line)).slice(0, 6)

  return (
    `📝 *Notes summary*\n\n` +
    `*Key themes*\n` +
    (themes.length ? themes.map((line) => `• ${shortText(line, 110)}`).join('\n') : `• ${shortText(bullets[0] || 'No clear themes found.', 110)}`) +
    `\n\n*Action items*\n` +
    (actions.length ? actions.map((line, idx) => `${idx + 1}. ${shortText(line, 110)}`).join('\n') : `1. Review saved notes and decide next steps`) +
    `\n\nYou can say:\n• delete note 1\n• done note 2\n• clear notes`
  )
}

export async function buildNotesReply(telegramId: number, text: string) {
  const lower = (text || '').toLowerCase().trim()

  if (wantsSummarizeNotes(lower)) {
    return await summarizeNotes(telegramId)
  }

  if (wantsClearNotes(lower)) {
    const notes = await getList(telegramId, 'notes')
    const count = notes?.items?.length || 0
    await clearList(telegramId, 'notes')
    return `🗑️ *Notes cleared*\n\nDeleted ${count} saved note${count === 1 ? '' : 's'}.`
  }

  if (wantsDeleteNote(lower)) {
    const index = parseIndex(lower)
    const notes = await getList(telegramId, 'notes')
    const items = ((notes?.items || []) as ListItem[])

    if (index === null || !items[index]) {
      return `I couldn’t find that note.\n\nTry *my notes* and then *delete note 1*.`
    }

    const deleted = items[index]
    const updated = items.filter((_, i) => i !== index)
    await updateNotesList(telegramId, updated)

    return `🗑️ *Note deleted*\n\n${shortText(deleted.text, 160)}`
  }

  if (wantsDoneNote(lower)) {
    const index = parseIndex(lower)
    const notes = await getList(telegramId, 'notes')
    const items = ((notes?.items || []) as ListItem[])

    if (index === null || !items[index]) {
      return `I couldn’t find that note.\n\nTry *my notes* and then *done note 1*.`
    }

    const updated = items.map((item, i) => (i === index ? { ...item, done: true } : item))
    await updateNotesList(telegramId, updated)

    return `✅ *Note marked done*\n\n${shortText(items[index].text, 160)}`
  }

  if (wantsAddNote(lower)) {
    const note = cleanNoteText(text)

    if (!note) {
      return (
        `📝 *Notes*\n\n` +
        `What should I save?\n\n` +
        `Try:\n` +
        `• Add note Follow up with Mathew on Monday\n` +
        `• Note: Check Razorpay verification status`
      )
    }

    const items = await addToList(telegramId, 'notes', [note])

    return (
      `✅ *Note saved*\n\n` +
      `${note}\n\n` +
      `You now have ${items.length} note${items.length === 1 ? '' : 's'}.\n` +
      `Type *my notes* to see them.`
    )
  }

  const notes = await getList(telegramId, 'notes')

  if (!notes || !notes.items?.length) {
    return (
      `📝 *Your notes*\n\n` +
      `No notes saved yet.\n\n` +
      `Try:\n` +
      `• Add note Follow up with Mathew on Monday\n` +
      `• Note: Check Razorpay verification status\n` +
      `• Save note Ask Srinivas about product roadmap`
    )
  }

  return (
    formatList('notes', notes.items || []) +
    `\n\nYou can say:\n` +
    `• summarize my notes\n` +
    `• delete note 1\n` +
    `• done note 2\n` +
    `• clear notes`
  )
}
