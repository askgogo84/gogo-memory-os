import { addToList, formatList, getList } from '@/lib/lists'

function cleanNoteText(text: string) {
  return (text || '')
    .replace(/^(add|save|create|write)\s+(a\s+)?note\s*(to|that|:)?\s*/i, '')
    .replace(/^note\s*(to|that|:)?\s*/i, '')
    .replace(/^remember\s+this\s*(as\s+a\s+note)?\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
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
    lower.startsWith('add note') ||
    lower.startsWith('save note') ||
    lower.startsWith('create note') ||
    lower.startsWith('write note') ||
    lower.startsWith('note:') ||
    lower.startsWith('note to') ||
    lower.startsWith('note that')
  )
}

export async function buildNotesReply(telegramId: number, text: string) {
  const lower = (text || '').toLowerCase().trim()

  const wantsAdd =
    lower.startsWith('add note') ||
    lower.startsWith('save note') ||
    lower.startsWith('create note') ||
    lower.startsWith('write note') ||
    lower.startsWith('note:') ||
    lower.startsWith('note to') ||
    lower.startsWith('note that')

  if (wantsAdd) {
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

  return formatList('notes', notes.items || [])
}
