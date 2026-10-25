// 19 Oct live: the browser spent its whole 3-minute read budget on Toit's ReserveGo widget and timed out
// (browser_read_deadline), so Gogo said it couldn't read tables. The widget itself loads its times from a
// public, unauthenticated JSON endpoint (observed in the widget's own network traffic):
//   POST https://api.reservego.co/api/bookings/widgets/timeSlots {outletId, channel:'Widget', date, widgetSlotNames:1}
// Reading that is the same read the public widget does, in under a second. Read-only; nothing is booked here.

const OUTLET_RE = /reserveOutlets\/([a-f0-9]{24})/i
const WIDGET_LINK_RE = /https?:\/\/widget\.reservego\.co(?:m)?\/reserveOutlets\/[a-f0-9]{24}[^"'\s<>)]*/i

export function reservegoOutletId(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/(?:^|\.)reservego\.co(?:m)?$/i.test(u.hostname)) return null
    return u.pathname.match(OUTLET_RE)?.[1]?.toLowerCase() || null
  } catch { return null }
}

export function reservegoWidgetLinkFromHtml(html: string): string | null {
  const hit = String(html || '').replace(/&amp;/g, '&').match(WIDGET_LINK_RE)
  return hit ? hit[0] : null
}

/** The ReserveGo widget for a provider URL: the URL itself, or a widget link on the restaurant's own page. */
export async function findReservegoWidget(url: string, fetcher: typeof fetch = fetch): Promise<{outletId: string; widgetUrl: string} | null> {
  const direct = reservegoOutletId(url)
  if (direct) return {outletId: direct, widgetUrl: url}
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    const res = await fetcher(url, {cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(6_000), headers: {'User-Agent': 'Mozilla/5.0 (compatible; AskGogo/1.0)'}})
    if (!res.ok) return null
    const link = reservegoWidgetLinkFromHtml((await res.text()).slice(0, 2_000_000))
    const outletId = link ? reservegoOutletId(link) : null
    return link && outletId ? {outletId, widgetUrl: link} : null
  } catch { return null }
}

/** "07:00 PM" -> "19:00" */
export function reservegoClock(raw: string): string | null {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (/p/i.test(m[3])) h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

export type ReservegoSlots = {slots: string[]; feeSlots: string[]}
/** Open times for the date, "HH:MM" 24h, sorted. Throws on any transport or shape problem so callers can fall back. */
export async function fetchReservegoSlots(outletId: string, date: string, fetcher: typeof fetch = fetch): Promise<ReservegoSlots> {
  if (!/^[a-f0-9]{24}$/i.test(outletId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('reservego_bad_input')
  const res = await fetcher('https://api.reservego.co/api/bookings/widgets/timeSlots', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(8_000),
    headers: {'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify({outletId, channel: 'Widget', date, widgetSlotNames: 1}),
  })
  if (!res.ok) throw new Error(`reservego_http_${res.status}`)
  const data = await res.json()
  if (data?.code !== 'SUCCESS' || !Array.isArray(data?.timeslots)) throw new Error('reservego_shape')
  const slots = new Set<string>(), feeSlots = new Set<string>()
  for (const group of data.timeslots) {
    if (Number(group?.status) !== 1 || !Array.isArray(group?.slots)) continue
    for (const s of group.slots) {
      const clock = reservegoClock(s?.Time)
      if (!clock || Number(s?.status) !== 1 || !(Number(s?.available) > 0)) continue
      slots.add(clock)
      if (Number(String(s?.amount ?? '0').replace(/[^\d.]/g, '')) > 0) feeSlots.add(clock)
    }
  }
  return {slots: [...slots].sort(), feeSlots: [...feeSlots].sort()}
}
