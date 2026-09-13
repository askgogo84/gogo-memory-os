import { parseReminderIntent, buildReminderConfirmation, getAmbiguousReminderTime, buildAmPmClarificationReply } from './reminders'
import { pickRecurringDuplicate } from '@/lib/bot/reminder-dedup'

export type NumberedChecklist = { listName: string; items: string[] }
export type NaturalReminderPendingContext = { task: string | null; dateText: string | null }

const MONTH = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)'
const WEEKDAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)'

export function normalizeNaturalReminderSave(text: string): string | null {
  const raw = String(text || '').trim()
  const match = raw.match(/^\s*(?:please\s+)?(?:save|make|create)(?:\s+this)?\s+(?:as\s+)?(?:a\s+)?reminder\b[\s:,-]*(.*)$/i)
  if (!match) return null
  const rest = String(match[1] || '').trim()
  return rest ? `remind me ${rest}` : 'remind me'
}

function stripWrapper(normalized:string) {
  return String(normalized||'').replace(/^\s*remind\s+me(?:\s+to)?\s*/i,'').trim()
}

export function naturalReminderPendingContext(normalized:string):NaturalReminderPendingContext {
  let task=stripWrapper(normalized)
  if (!task) return { task:null, dateText:null }
  let dateText:string|null=null

  // Keep scheduling context separate from the task so a two-turn reminder can use
  // the mature date parser without polluting the final reminder subject.
  const absolute = task.match(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}(?:\\s+\\d{4})?\\b`,'i'))
  const relative = task.match(/\b(?:today|tomorrow|tmrw|tmr|day after tomorrow)\b/i)
  const weekday = task.match(new RegExp(`\\b(?:on\\s+)?(?:(?:this|next)\\s+)?${WEEKDAY}\\b`,'i'))
  const picked=absolute||relative||weekday
  if (picked?.[0]) {
    dateText=picked[0].trim()
    const idx=picked.index||0
    task=`${task.slice(0,idx)} ${task.slice(idx+picked[0].length)}`.replace(/\s+/g,' ').trim()
  }

  // A day-part is useful conversational context but not precise enough to schedule.
  // Remove it from the subject and ask for a concrete clock time.
  task=task.replace(/\b(?:morning|afternoon|evening|night)\b/ig,' ').replace(/\s+/g,' ').trim()
  task=task.replace(/\b(?:at|on|for)\s*$/i,'').replace(/\s+/g,' ').trim()
  return { task:task||null, dateText }
}

export function naturalReminderTask(normalized:string):string|null {
  return naturalReminderPendingContext(normalized).task
}

export function hasExplicitReminderTiming(normalized:string):boolean {
  const t=String(normalized||'')
  if(/\bin\s+\d+\s+(?:minute|minutes|min|mins|hour|hours|day|days)\b/i.test(t))return true
  if(/\b(?:noon|midday|midnight)\b/i.test(t))return true
  if(/\b\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?\b/i.test(t))return true
  if(/\b\d{1,2}\s*(?:am|pm)\b/i.test(t))return true
  return false
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
  const { saveFollowupState } = await import('./followup-state')
  const pending=naturalReminderPendingContext(normalized)

  if (getAmbiguousReminderTime(normalized)) {
    await saveFollowupState(params.telegramId,'reminder_ampm',{
      originalText:normalized,
      channel:params.whatsappTo?'whatsapp':'unknown',
      created_at:new Date().toISOString(),
    })
    return buildAmPmClarificationReply(normalized)
  }

  // Date/day/day-part without a clock time is incomplete. Persist subject + date
  // separately so a later "8 pm" keeps the original date without polluting the title.
  if (!hasExplicitReminderTiming(normalized)) {
    await saveFollowupState(params.telegramId,'pending_reminder',{
      task:pending.task,
      dateText:pending.dateText,
      day:null,
      recurrence:null,
      created_at:new Date().toISOString(),
    })
    return `Sure — what time should I remind you?\n_e.g. “8 PM”, “tomorrow 6 PM”, or “in 2 hours”_`
  }

  const parsed = parseReminderIntent(normalized)
  if (!parsed) {
    await saveFollowupState(params.telegramId,'pending_reminder',{
      task:pending.task,
      dateText:pending.dateText,
      day:null,
      recurrence:null,
      created_at:new Date().toISOString(),
    })
    return `I understood this as a reminder. When should I remind you?\n_e.g. “27 September at 9 AM”, “tomorrow 6 PM”, or “in 2 hours”_`
  }

  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { data: user } = await supabaseAdmin.from('users').select('timezone').eq('telegram_id', params.telegramId).maybeSingle()
  const timezone = String(user?.timezone || 'Asia/Kolkata')
  let duplicateId: string | null = null

  if (parsed.kind === 'recurring') {
    const { data } = await supabaseAdmin.from('reminders')
      .select('id,message,remind_at')
      .eq('telegram_id', params.telegramId)
      .eq('sent', false)
      .eq('is_recurring', true)
      .eq('recurring_pattern', parsed.pattern)
      .eq('message', parsed.message)
      .limit(12)
    const duplicate=pickRecurringDuplicate(data || [], parsed.remindAtIso)
    duplicateId = duplicate?.id ? String(duplicate.id) : null
  } else {
    const { data } = await supabaseAdmin.from('reminders').select('id')
      .eq('telegram_id', params.telegramId)
      .eq('sent', false)
      .or('is_recurring.is.null,is_recurring.eq.false')
      .eq('remind_at', parsed.remindAtIso)
      .eq('message', parsed.message)
      .limit(1)
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