import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseReminderIntent } from './reminders'

// Phase 1C — Friend-to-friend reminders.
// "remind Divya to pay me ₹700 tomorrow" -> Divya gets the ping.
// Delivery reuses the existing reminders cron: a row with whatsapp_to set is
// sent to that number. No reminder-schema change needed.

const DAILY_CAP = 5

/** Detect "remind <name> to <task>" where <name> is NOT the sender. */
export function detectFriendReminder(text: string): { name: string; rest: string } | null {
  const m = (text || '').match(
    /^\s*remind\s+(?!me\b|myself\b|us\b|everyone\b|everybody\b)([a-z][\w'-]{1,24})\s+(?:to\s+)?(.+)$/i
  )
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
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count } = await supabaseAdmin
    .from('reminders')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', ownerTelegramId)
    .not('whatsapp_to', 'is', null)
    .gte('created_at', since.toISOString())
  return count || 0
}

/** Turn "pay me ₹700 tomorrow" into { remindAtIso, task } using the reminder parser. */
export function parseFriendTime(rest: string): { remindAtIso: string; task: string } {
  const parsed = parseReminderIntent(`remind me to ${rest}`)
  if (parsed && parsed.remindAtIso) {
    return { remindAtIso: parsed.remindAtIso, task: parsed.message || rest }
  }
  // default: tomorrow 09:00 IST (03:30 UTC)
  const d = new Date(Date.now() + 864e5)
  d.setUTCHours(3, 30, 0, 0)
  return { remindAtIso: d.toISOString(), task: rest }
}

export const FRIEND_DAILY_CAP = DAILY_CAP

/** Create the reminder row for the recipient. Returns human-friendly time. */
export async function createFriendReminder(params: {
  ownerTelegramId: number
  senderName: string
  recipientWhatsapp: string
  rest: string
}): Promise<{ whenHuman: string }> {
  const { remindAtIso, task } = parseFriendTime(params.rest)
  const message = `⏰ Reminder from ${params.senderName || 'a friend'}: ${task}`
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
  if (error) console.error('FRIEND_REMINDER_INSERT_FAILED:', error.message)
  const whenHuman = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(remindAtIso))
  return { whenHuman }
}

// ---- pending "what's their number?" state, stored as a conversation marker ----
const PENDING_PREFIX = '[pending_friend]'

export function pendingFriendMarker(name: string, rest: string): string {
  return `${PENDING_PREFIX} ${JSON.stringify({ name, rest, at: new Date().toISOString() })}`
}

export async function getPendingFriend(telegramId: number): Promise<{ name: string; rest: string } | null> {
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
  // only valid for 15 minutes
  if (Date.now() - new Date(row.created_at).getTime() > 15 * 60 * 1000) return null
  try {
    const parsed = JSON.parse(row.content.slice(PENDING_PREFIX.length).trim())
    return { name: parsed.name, rest: parsed.rest }
  } catch {
    return null
  }
}

export function cap0(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
