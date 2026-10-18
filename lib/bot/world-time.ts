import { timezoneFromCity } from '../timezone'

// 18 Oct live: "what is the time in New York now" came back 30 minutes off — the model did the
// IST arithmetic itself. A named city's clock is read from the time-zone database instead.
const EXTRA: Record<string, string> = {
  new_york_city: 'America/New_York', boston: 'America/New_York', washington: 'America/New_York', toronto: 'America/Toronto',
  chicago: 'America/Chicago', seattle: 'America/Los_Angeles', vancouver: 'America/Vancouver', paris: 'Europe/Paris',
  berlin: 'Europe/Berlin', amsterdam: 'Europe/Amsterdam', frankfurt: 'Europe/Berlin', zurich: 'Europe/Zurich',
  hong_kong: 'Asia/Hong_Kong', shanghai: 'Asia/Shanghai', beijing: 'Asia/Shanghai', seoul: 'Asia/Seoul',
  doha: 'Asia/Qatar', riyadh: 'Asia/Riyadh', kathmandu: 'Asia/Kathmandu', colombo: 'Asia/Colombo', dhaka: 'Asia/Dhaka',
  auckland: 'Pacific/Auckland', usa: 'America/New_York', us: 'America/New_York', japan: 'Asia/Tokyo', australia: 'Australia/Sydney',
}

export function worldTimeReply(text: string, now = new Date()): string | null {
  const m = String(text || '').trim().match(/^(?:what(?:'s|’s| is)?\s+)?(?:the\s+)?(?:current\s+)?time\s+(?:is\s+it\s+)?(?:now\s+)?in\s+([a-z][a-z .'-]{1,40}?)(?:\s+(?:now|right now|currently))?\s*\??$/i)
    || String(text || '').trim().match(/^what\s+time\s+is\s+it\s+in\s+([a-z][a-z .'-]{1,40}?)(?:\s+(?:now|right now))?\s*\??$/i)
  if (!m) return null
  const city = m[1].trim().replace(/\.$/, '')
  const key = city.toLowerCase().replace(/[\s-]+/g, '_')
  const zone = timezoneFromCity(city) || EXTRA[key]
  if (!zone) return null
  const fmt = (tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...o }).format(now)
  const there = fmt(zone, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?(am|pm)/i, (_, p) => ` ${p.toUpperCase()}`)
  const day = fmt(zone, { weekday: 'short', day: 'numeric', month: 'short' })
  const abbr = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || zone
  const name = city.replace(/\b\w/g, c => c.toUpperCase())
  if (zone === 'Asia/Kolkata') return `Current time in ${name}: *${there}* (${day}, IST)`
  const ist = fmt('Asia/Kolkata', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?(am|pm)/i, (_, p) => ` ${p.toUpperCase()}`)
  return `Current time in ${name}: *${there}* (${day}, ${abbr})\nIn India it is ${ist}.`
}
