import { supabaseAdmin } from '@/lib/supabase-admin'
import { istDayWindow } from '@/lib/ist'
import { parseReminderIntent, reminderTimingProblem } from './reminders'

// Phase 1C — Friend-to-friend reminders.
// "remind Divya to pay me ₹700 tomorrow" -> Divya gets the ping.
// Delivery reuses the existing reminders cron: a row with whatsapp_to set is
// sent to that number. No reminder-schema change needed.

/** Detect "remind <name> to <task>" where <name> is NOT the sender. */
export function detectFriendReminder(text: string): { name: string; rest: string } | null {
  const cleaned = (text || '').replace(/^\s*(?:hey\s+)?gogo[,!\s]+/i, '')
    .replace(/^\s*(?:can|could|would)\s+you\s+/i, '').replace(/^\s*please\s+/i, '')
  const m = cleaned.match(/^\s*(?:remind|ask|tell|ping|message)\s+(?!me\b|myself\b|us\b|everyone\b|everybody\b)([a-z][\w'-]{1,24})\s+to\s+(.+)$/i)
  if (!m) return null
  return { name: m[1].trim().toLowerCase(), rest: m[2].trim() }
}

/** Normalize an Indian/E.164 phone number to +<digits>. Returns null if not phone-like. */
export function normalizePhoneNumber(raw: string): string | null {
  const digits = (raw || '').replace(/[^\d+]/g, '')
  const bare = digits.replace(/^\+/, '')
  if (bare.length === 10) return `+91${bare}`
  if (bare.length === 12 && bare.startsWith('91')) return `+${bare}`
  if (digits.startsWith('+') && bare.length >= 11 && bare.length <= 15) return `+${bare}`
  return null
}

export function isFriendReminderFollowupCandidate(text: string): boolean {
  const answer = String(text || '').trim()
  return Boolean(normalizePhoneNumber(answer)) || /^(?:yes|confirm|no|cancel)[.!]?$/i.test(answer) ||
    /^(?:(?:(?:today|tomorrow|on\s+\w+)\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm))|(?:\d{1,2}(?::\d{2})?\s*(?:am|pm))|(?:in\s+\d+\s+(?:minutes?|hours?|days?)))[.!]?$/i.test(answer)
}

export async function resolveFriendContact(ownerTelegramId: number, name: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('friend_contacts')
    .select('whatsapp_id')
    .eq('owner_telegram_id', ownerTelegramId)
    .eq('name', name)
    .maybeSingle()
  return data?.whatsapp_id ?? null
}

export async function saveFriendContact(ownerTelegramId: number, name: string, whatsappId: string): Promise<void> {
  await supabaseAdmin
    .from('friend_contacts')
    .upsert({ owner_telegram_id: ownerTelegramId, name, whatsapp_id: whatsappId }, { onConflict: 'owner_telegram_id,name' })
}

export async function countTodayFriendReminders(ownerTelegramId: number): Promise<number> {
  // Bug 3: count the user's *local* (IST) day, not the UTC day. The day window is
  // the shared helper in lib/ist — same one the dashboard reads today's reminders by.
  const { startUtc } = istDayWindow()
  const { count } = await supabaseAdmin
    .from('reminders')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', ownerTelegramId)
    .not('whatsapp_to', 'is', null)
    .gte('created_at', startUtc.toISOString())
  return count || 0
}

/** A delegated reminder requires a specific future time; never invent 9 AM. */
export function parseFriendTime(rest: string, now = new Date()): { remindAtIso: string; task: string } | null {
  if (/\b(?:when|once)\s+\w+\s+wakes?\s+up\b/i.test(rest)) return null
  const hasTime = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\bnoon\b|\bmidnight\b|\bin\s+\d+\s+(?:minutes?|hours?|days?)\b/i.test(rest)
  if (!hasTime) return null
  const istHour = Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false}).format(now))
  const normalized = istHour < 4 && !/\bday after tomorrow\b/i.test(rest)
    ? rest.replace(/\btomorrow\b/gi, 'today') : rest
  if (reminderTimingProblem(normalized)) return null
  const parsed = parseReminderIntent(`remind me to ${normalized}`)
  if (!parsed || Date.parse(parsed.remindAtIso) <= now.getTime()) return null
  return {remindAtIso: parsed.remindAtIso, task: (parsed.message || rest).replace(/\bUrgent[.!]?\s*$/i, '').trim()}
}

export function friendTaskWithoutTime(rest: string): string {
  return rest.replace(/\b(?:like\s+)?when\s+\w+\s+wakes?\s+up(?:\s+tomorrow)?\b/gi, '')
    .replace(/\b(?:today|tomorrow)\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '')
    .replace(/\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s+(?:today|tomorrow))?\b/gi, '')
    .replace(/\b(?:today|tomorrow)\b/gi, '').replace(/\bUrgent[.!]?\s*$/i, '')
    .replace(/\s+/g, ' ').replace(/[\s,.]+$/g, '').trim()
}

export function friendTimeLabel(remindAtIso: string): string {
  return new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true}).format(new Date(remindAtIso)) + ' IST'
}

/** Create the reminder row for the recipient. Returns human-friendly time. */
export async function createFriendReminder(params: {
  ownerTelegramId: number
  senderName: string
  recipientWhatsapp: string
  rest: string
  whenIso?: string
  task?: string
}): Promise<{ whenHuman: string }> {
  const parsed = params.whenIso && params.task
    ? (Date.parse(params.whenIso) > Date.now() ? {remindAtIso: params.whenIso, task: params.task} : null)
    : parseFriendTime(params.rest)
  if (!parsed) throw new Error('friend_reminder_time_unresolved')
  const { remindAtIso, task } = parsed
  // Body must NOT start with "⏰ Reminder" — the delivery template already prepends
  // "⏰ Reminder:" (and the cron prepends a context emoji). Embedding it here again
  // produced the doubled "⏰ Reminder: 📞 ⏰ Reminder from Gogo: …". Keep only "from
  // <sender>:" so it renders once as "⏰ Reminder: 📞 from Gogo: …".
  const message = `from ${params.senderName || 'a friend'}: ${task}`
  const { data: owner } = await supabaseAdmin
    .from('users')
    .select('timezone')
    .eq('telegram_id', params.ownerTelegramId)
    .maybeSingle()
  const { error } = await supabaseAdmin.from('reminders').insert({
    telegram_id: params.ownerTelegramId,
    chat_id: params.ownerTelegramId,
    whatsapp_to: params.recipientWhatsapp,
    message,
    remind_at: remindAtIso,
    sent: false,
    timezone: owner?.timezone || 'Asia/Kolkata',
  })
  if (error) throw new Error('friend_reminder_insert_failed')
  const whenHuman = friendTimeLabel(remindAtIso)
  return { whenHuman }
}

// ---- pending "what's their number?" state, stored as a conversation marker ----
const PENDING_PREFIX = '[pending_friend]'

export type PendingFriend = {name: string; rest: string; stage: 'time' | 'number' | 'confirm' | 'done'; number?: string; whenIso?: string; task?: string}
export function pendingFriendMarker(name: string, rest: string, stage: PendingFriend['stage'] = 'number', number?: string, parsed?: {remindAtIso: string; task: string}): string {
  return `${PENDING_PREFIX} ${JSON.stringify({name, rest, stage, number, whenIso: parsed?.remindAtIso, task: parsed?.task, at: new Date().toISOString()})}`
}

export async function getPendingFriend(telegramId: number): Promise<PendingFriend | null> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('content, created_at')
    .eq('telegram_id', telegramId)
    .eq('role', 'user')
    .like('content', `${PENDING_PREFIX}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  const row = data?.[0]
  if (!row) return null
  try {
    const parsed = JSON.parse(row.content.slice(PENDING_PREFIX.length).trim())
    // A number/time request can stay pending across a day. A YES confirmation
    // expires quickly so an unrelated later YES cannot schedule an old task.
    const ttlMs = parsed.stage === 'confirm' ? 15 * 60_000 : 24 * 60 * 60_000
    if (Date.now() - new Date(row.created_at).getTime() > ttlMs) return null
    return parsed.stage === 'done' ? null : {name: parsed.name, rest: parsed.rest, stage: parsed.stage || 'number', number: parsed.number, whenIso: parsed.whenIso, task: parsed.task}
  } catch {
    return null
  }
}

export function cap0(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
