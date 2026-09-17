import { parseReminderIntent, buildReminderConfirmation, getAmbiguousReminderTime, buildAmPmClarificationReply } from './reminders'
import { pickRecurringDuplicate } from '@/lib/bot/reminder-dedup'
import { formatReminderWhen } from '@/lib/services/reminder-series'

export type NumberedChecklist = { listName: string; items: string[] }
export type NaturalReminderPendingContext = { task: string | null; dateText: string | null }
export type ListReminderCompound = { listName: string; items: string[]; reminderText: string }

const MONTH = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)'
const WEEKDAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)'
const REMINDER_READ_SENTINEL = '__askgogo_read_reminders__'

export function isReminderReadQuery(text: string): boolean {
  const t = String(text || '').trim().toLowerCase().replace(/[?.!]+$/g, '').trim()
  if (!/\breminders?\b/.test(t)) return false
  if (/\b(set|create|make|add|schedule)\b/.test(t) || /\bremind\s+me\b/.test(t)) return false
  return (
    /^(?:show|list|display)(?:\s+me)?(?:\s+my)?\s+reminders?\b/.test(t) ||
    /^(?:my|pending|active)\s+reminders?\b/.test(t) ||
    /^(?:what|which)\s+reminders?\b/.test(t) ||
    /^what\s+are\s+my\s+reminders?\b/.test(t) ||
    /^do\s+i\s+have\s+(?:any\s+)?reminders?\b/.test(t) ||
    /^are\s+there\s+(?:any\s+)?reminders?\b/.test(t)
  )
}

function cleanCompoundItem(value: string) {
  return String(value || '').replace(/^[,;\s]+|[,;\s.]+$/g, '').replace(/\s+/g, ' ').trim()
}

export function parseListReminderCompound(text: string): ListReminderCompound | null {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  const match = raw.match(/^\s*(?:please\s+)?(?:create|make)\s+(?:a\s+)?list\s+(?:called|named)\s+(.+?)\s+with\s+(.+?)(?:[.!?]\s*|\s+then\s+)(remind\s+me\b.+)$/i)
  if (!match) return null
  const listName = String(match[1] || '').trim().replace(/[.!?]+$/g, '').trim()
  const items = String(match[2] || '')
    .split(/\s*(?:,|\band\b)\s*/i)
    .map(cleanCompoundItem)
    .filter(Boolean)
    .slice(0, 20)
  const reminderText = String(match[3] || '').trim()
  if (!listName || items.length < 1 || !reminderText) return null
  return { listName, items, reminderText }
}

export function normalizeNaturalReminderSave(text: string): string | null {
  const raw = String(text || '').trim()
  if (isReminderReadQuery(raw)) return REMINDER_READ_SENTINEL
  const compound = parseListReminderCompound(raw)
  if (compound) return compound.reminderText
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

  const absolute = task.match(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}(?:\\s+\\d{4})?\\b`,'i'))
  const relative = task.match(/\b(?:today|tomorrow|tmrw|tmr|day after tomorrow)\b/i)
  const weekday = task.match(new RegExp(`\\b(?:on\\s+)?(?:(?:this|next)\\s+)?${WEEKDAY}\\b`,'i'))
  const picked=absolute||relative||weekday
  if (picked?.[0]) {
    dateText=picked[0].trim()
    const idx=picked.index||0
    task=`${task.slice(0,idx)} ${task.slice(idx+picked[0].length)}`.replace(/\s+/g,' ').trim()
  }

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

function istDateKey(d: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

async function showReminderReadQuery(telegramId: number, text: string): Promise<string> {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { data, error } = await supabaseAdmin.from('reminders')
    .select('id,message,remind_at,sent,is_recurring,recurring_pattern')
    .eq('telegram_id', telegramId)
    .eq('sent', false)
    .order('remind_at', { ascending: true })
    .limit(100)
  if (error) throw new Error(`reminder_read_failed:${error.message}`)

  const now = new Date()
  const targetKey = /\btomorrow\b/i.test(text)
    ? istDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))
    : /\btoday\b/i.test(text)
      ? istDateKey(now)
      : null

  let rows = (data || []).filter((r:any) => r?.remind_at && Number.isFinite(new Date(r.remind_at).getTime()))
  if (targetKey) rows = rows.filter((r:any) => istDateKey(new Date(r.remind_at)) === targetKey)

  const seen = new Set<string>()
  rows = rows.filter((r:any) => {
    const key = `${String(r.message || '').trim().toLowerCase()}|${String(r.remind_at)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 10)

  const scope = targetKey ? (/\btomorrow\b/i.test(text) ? 'tomorrow' : 'today') : 'active'
  if (!rows.length) return scope === 'active' ? `⏰ You have no active reminders right now.` : `⏰ You have no reminders for ${scope}.`

  return (
    `⏰ *Your ${scope} reminders*\n\n` +
    rows.map((r:any, i:number) => `${i + 1}. ${String(r.message || 'Reminder').replace(/^to\s+/i,'').trim()} — ${formatReminderWhen(r.remind_at)}`).join('\n')
  )
}

export async function saveNaturalReminder(params: {
  telegramId: number
  whatsappTo?: string | null
  text: string
}): Promise<string | null> {
  const normalized = normalizeNaturalReminderSave(params.text)
  if (!normalized) return null
  if (normalized === REMINDER_READ_SENTINEL) return await showReminderReadQuery(params.telegramId, params.text)

  const compound = parseListReminderCompound(params.text)
  let compoundListReply = ''
  if (compound) {
    const { addToListDetailed, getList, normalizeListName } = await import('@/lib/lists')
    const listName = normalizeListName(compound.listName)
    const result = await addToListDetailed(params.telegramId, listName, compound.items)
    const stored = await getList(params.telegramId, listName)
    const storedItems = Array.isArray(stored?.items) ? stored.items : []
    const pending = new Set(storedItems.filter((x:any)=>!x?.done).map((x:any)=>String(x?.text||'').trim().toLowerCase().replace(/\s+/g,' ')))
    const missing = compound.items.filter(item=>!pending.has(String(item).trim().toLowerCase().replace(/\s+/g,' ')))
    if (missing.length) throw new Error(`compound_list_persistence_incomplete:${missing.length}`)
    const changed = result.added.length + result.reactivated.length
    compoundListReply = changed
      ? `✅ List *${listName}* saved with ${compound.items.length} item${compound.items.length===1?'':'s'}.`
      : `✅ List *${listName}* already has those ${compound.items.length} item${compound.items.length===1?'':'s'}.`
  }

  const { saveFollowupState } = await import('./followup-state')
  const pending=naturalReminderPendingContext(normalized)

  if (getAmbiguousReminderTime(normalized)) {
    await saveFollowupState(params.telegramId,'reminder_ampm',{
      originalText:normalized,
      channel:params.whatsappTo?'whatsapp':'unknown',
      created_at:new Date().toISOString(),
    })
    const reply = buildAmPmClarificationReply(normalized)
    return compoundListReply ? `${compoundListReply}\n\n${reply}` : reply
  }

  if (!hasExplicitReminderTiming(normalized)) {
    await saveFollowupState(params.telegramId,'pending_reminder',{
      task:pending.task,
      dateText:pending.dateText,
      day:null,
      recurrence:null,
      created_at:new Date().toISOString(),
    })
    const reply = `Sure — what time should I remind you?\n_e.g. “8 PM”, “tomorrow 6 PM”, or “in 2 hours”_`
    return compoundListReply ? `${compoundListReply}\n\n${reply}` : reply
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
    const reply = `I understood this as a reminder. When should I remind you?\n_e.g. “27 September at 9 AM”, “tomorrow 6 PM”, or “in 2 hours”_`
    return compoundListReply ? `${compoundListReply}\n\n${reply}` : reply
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

  const reminderReply = buildReminderConfirmation(parsed)
  return compoundListReply ? `${compoundListReply}\n\n${reminderReply}` : reminderReply
}