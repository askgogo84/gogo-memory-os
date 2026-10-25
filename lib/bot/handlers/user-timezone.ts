import { supabaseAdmin } from '@/lib/supabase-admin'

const DEFAULT_TIMEZONE = 'Asia/Kolkata'

const TIMEZONE_ALIASES: Record<string, string> = {
  india: 'Asia/Kolkata',
  ist: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  bengaluru: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  chennai: 'Asia/Kolkata',
  hyderabad: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata',

  dubai: 'Asia/Dubai',
  uae: 'Asia/Dubai',
  abudhabi: 'Asia/Dubai',
  'abu dhabi': 'Asia/Dubai',
  sharjah: 'Asia/Dubai',

  singapore: 'Asia/Singapore',
  sg: 'Asia/Singapore',
  malaysia: 'Asia/Kuala_Lumpur',
  kualalumpur: 'Asia/Kuala_Lumpur',
  'kuala lumpur': 'Asia/Kuala_Lumpur',

  london: 'Europe/London',
  uk: 'Europe/London',
  england: 'Europe/London',

  paris: 'Europe/Paris',
  france: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  germany: 'Europe/Berlin',
  amsterdam: 'Europe/Amsterdam',

  newyork: 'America/New_York',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  usa: 'America/New_York',
  us: 'America/New_York',
  chicago: 'America/Chicago',
  dallas: 'America/Chicago',
  texas: 'America/Chicago',
  la: 'America/Los_Angeles',
  losangeles: 'America/Los_Angeles',
  'los angeles': 'America/Los_Angeles',
  california: 'America/Los_Angeles',
  sanfrancisco: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',

  toronto: 'America/Toronto',
  canada: 'America/Toronto',
  vancouver: 'America/Vancouver',

  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  australia: 'Australia/Sydney',

  japan: 'Asia/Tokyo',
  tokyo: 'Asia/Tokyo',
  hongkong: 'Asia/Hong_Kong',
  'hong kong': 'Asia/Hong_Kong',
}

export function isValidTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function cleanTimezoneInput(value: string) {
  return (value || '')
    .toLowerCase()
    .replace(/^set\s+(my\s+)?timezone\s*(to|as)?\s*/i, '')
    .replace(/^my\s+timezone\s+is\s*/i, '')
    .replace(/^timezone\s*(is|to)?\s*/i, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveTimeZoneFromText(text: string) {
  const raw = (text || '').trim()
  const clean = cleanTimezoneInput(raw)
  const compact = clean.replace(/\s+/g, '')

  if (isValidTimeZone(raw)) return raw
  if (isValidTimeZone(clean)) return clean
  if (TIMEZONE_ALIASES[clean]) return TIMEZONE_ALIASES[clean]
  if (TIMEZONE_ALIASES[compact]) return TIMEZONE_ALIASES[compact]

  return null
}

export function inferTimezoneFromPhone(phone: string | null | undefined) {
  const digits = (phone || '').replace(/^whatsapp:/, '').replace(/\D/g, '')

  if (digits.startsWith('91')) return 'Asia/Kolkata'
  if (digits.startsWith('971')) return 'Asia/Dubai'
  if (digits.startsWith('44')) return 'Europe/London'
  if (digits.startsWith('65')) return 'Asia/Singapore'
  if (digits.startsWith('60')) return 'Asia/Kuala_Lumpur'
  if (digits.startsWith('61')) return 'Australia/Sydney'
  if (digits.startsWith('81')) return 'Asia/Tokyo'
  if (digits.startsWith('852')) return 'Asia/Hong_Kong'
  if (digits.startsWith('1')) return 'America/New_York'

  return DEFAULT_TIMEZONE
}

export function getUserTimeZone(user: any, whatsappId?: string | null) {
  const saved = user?.timezone || user?.time_zone || user?.tz
  if (isValidTimeZone(saved)) return saved
  return inferTimezoneFromPhone(user?.whatsapp_id || whatsappId)
}

export function isTimezoneCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower === 'timezone' ||
    lower === 'my timezone' ||
    lower === 'show timezone' ||
    lower.startsWith('set timezone') ||
    lower.startsWith('set my timezone') ||
    lower.startsWith('my timezone is') ||
    lower.startsWith('timezone ')
  )
}

function formatNow(timeZone: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date())
}

export async function buildTimezoneCommandReply(params: {
  text: string
  telegramId: number
  currentTimeZone: string
}) {
  const lower = (params.text || '').toLowerCase().trim()

  if (lower === 'timezone' || lower === 'my timezone' || lower === 'show timezone') {
    return (
      `🌍 *Your timezone*\n\n` +
      `Current: *${params.currentTimeZone}*\n` +
      `Local time now: *${formatNow(params.currentTimeZone)}*\n\n` +
      `To change it, type:\n` +
      `• set timezone Dubai\n` +
      `• set timezone London\n` +
      `• set timezone America/New_York`
    )
  }

  const timeZone = resolveTimeZoneFromText(params.text)

  if (!timeZone) {
    return (
      `I couldn’t identify that timezone.\n\n` +
      `Try:\n` +
      `• set timezone Dubai\n` +
      `• set timezone London\n` +
      `• set timezone Singapore\n` +
      `• set timezone America/New_York`
    )
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ timezone: timeZone })
    .eq('telegram_id', params.telegramId)

  if (error) {
    return `Timezone update failed: ${error.message}\n\nRun the timezone SQL migration first, then try again.`
  }

  return (
    `✅ *Timezone updated*\n\n` +
    `Timezone: *${timeZone}*\n` +
    `Local time now: *${formatNow(timeZone)}*\n\n` +
    `Your reminders will now use this timezone.`
  )
}
