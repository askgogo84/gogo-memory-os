import { parseReminderIntent, buildReminderConfirmation } from './reminders'

export type NumberedChecklist = { listName: string; items: string[] }

export function normalizeNaturalReminderSave(text: string): string | null {
  const raw = String(text || '').trim()
  const match = raw.match(/^\s*(?:please\s+)?(?:save|make|create)(?:\s+this)?\s+(?:as\s+)?(?:a\s+)?reminder\b[\s:,-]*(.*)$/i)
  if (!match) return null
  const rest = String(match[1] || '').trim()
  return rest ? `remind me ${rest}` : 'remind me'
}

export function naturalReminderTask(normalized:string):string|null {
  const task=String(normalized||'').replace(/^\s*remind\s+me(?:\s+to)?\s*/i,'').trim()
  return task||null
}

export function parseNumberedChecklist(text: string): NumberedChecklist | null {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!raw.includes('\n')) return null
  const lines = raw.split('\n')
  const header = String(lines.shift() || '').trim().replace(/[\s:–—-]+$/, '').trim()
  const headerMatch = header.match(/^(?:things|tasks|stuff|items)\s+to\s+do\s+(?:before|for)\s+(?:my\s+)?(.+)$/i)
    || header.match(/^(?:my\s+)?(.+?)\s+(?:to-?do|checklist)$/i)
  if (!headerMatch) return null
  const subject = String(headerMatch[1] || '').trim().replace(/^(?:the|my)\s+/i, '').replace(/\s+/g, ' ')
  if (!subject) return null

  const items = lines
    .map((line) => {
      const m = String(line || '').match(/^\s*\d+\s*(?:[-.)]|:)\s*(.*?)\s*$/)
      return m ? String(m[1] || '').trim() : ''
    })
    .filter(Boolean)

  if (items.length < 2) return null
  return { listName: subject, items }
}

export async function saveNaturalReminder(params: {
  telegramId: number
  whatsappTo?: string | null
  text: string
}): Promise<string | null> {
  const normalized = normalizeNaturalReminderSave(params.text)
  if (!normalized) return null
  const parsed = parseReminderIntent(normalized)
  if (!parsed) {
    const { saveFollowupState } = await import('./followup-state')
    await saveFollowupState(params.telegramId,'pending_reminder',{
      task:naturalReminderTask(normalized),
      day:null,
      recurrence:null,
      created_at:new Date().toISOString(),
    })
    return `I understood this as a reminder. When should I remind you?\n_e.g. “27 September at 9 AM”, “tomorrow 6 PM”, or “in 2 hours”_`
  }

  // Lazy-load the DB client so pure intent/parser tests never need production credentials.
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { data: user } = await supabaseAdmin.from('users').select('timezone').eq('telegram_id', params.telegramId).maybeSingle()
  const timezone = String(user?.timezone || 'Asia/Kolkata')
  let duplicateId: string | null = null

  if (parsed.kind === 'recurring') {
    const { data } = await supabaseAdmin.from('reminders').select('id').eq('telegram_id', params.telegramId).eq('sent', false).eq('is_recurring', true).eq('recurring_pattern', parsed.pattern).limit(1)
    duplicateId = data?.[0]?.id ? String(data[0].id) : null
  } else {
    const { data } = await supabaseAdmin.from('reminders').select('id').eq('telegram_id', params.telegramId).eq('sent', false).eq('remind_at', parsed.remindAtIso).eq('message', parsed.message).limit(1)
    duplicateId = data?.[0]?.id ? String(data[0].id) : null
  }

  const payload: any = {
    telegram_id: params.telegramId,
    chat_id: params.telegramId,
    message: parsed.message,
    remind_at: parsed.remindAtIso,
    sent: false,
    timezone,
  }
  if (params.whatsappTo) payload.whatsapp_to = params.whatsappTo
  if (parsed.kind === 'recurring') {
    payload.is_recurring = true
    payload.recurring_pattern = parsed.pattern
  }

  if (duplicateId) {
    const { error } = await supabaseAdmin.from('reminders').update(payload).eq('id', duplicateId)
    if (error) throw new Error(`natural_reminder_update_failed:${error.message}`)
  } else {
    const { error } = await supabaseAdmin.from('reminders').insert(payload)
    if (error) throw new Error(`natural_reminder_insert_failed:${error.message}`)
  }

  return buildReminderConfirmation(parsed)
}
