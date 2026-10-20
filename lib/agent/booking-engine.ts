// Booking engine (docs/architecture/08-booking-engine.md). Online bookings on District, Zomato, EazyDiner and
// similar apps are made in the person's OWN account: the app shows tables and books against their phone number,
// after they sign in with a one-time code. Gogo never bypasses that sign-in (no cookie export, no CAPTCHA
// solving, codes are typed by the person in their own secure browser). So the engine:
//   1. knows which booking sites need the person's sign-in,
//   2. checks whether they have connected that site (vault_sessions via listSiteConnections),
//   3. asks them to connect it once instead of spending minutes on a login wall it cannot pass,
//   4. records a provider-confirmed booking so "My bookings" and reminders pick it up.
// Every booking still needs the person's explicit yes (agent_approvals) and a provider confirmation.

import { CONNECTION_CATALOGUE, catalogueDomain, type CatalogueSite } from '@/lib/dashboard/connection-catalogue'

export const CONNECTIONS_SETTINGS_URL = 'https://app.askgogo.in/dashboard/settings?section=connections'
/** One-tap sign-in link for a site (Settings opens its secure sign-in straight away). */
export function signInLink(siteId: string | null | undefined): string {
  return siteId ? `${CONNECTIONS_SETTINGS_URL}&signin=${encodeURIComponent(siteId)}` : CONNECTIONS_SETTINGS_URL
}

// Apps that only show or book tables/tickets for a signed-in person.
export const SIGNED_IN_BOOKING_SITES = ['district', 'zomato', 'eazydiner', 'bookmyshow', 'swiggy'] as const

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

/** The catalogue site behind a booking URL when that site needs the person's own sign-in; null otherwise. Pure. */
export function signedInBookingSiteForUrl(url: string): CatalogueSite | null {
  const host = hostOf(url)
  if (!host) return null
  for (const id of SIGNED_IN_BOOKING_SITES) {
    const site = CONNECTION_CATALOGUE.find(s => s.id === id)
    if (!site) continue
    const domain = catalogueDomain(site)
    if (host === domain || host.endsWith('.' + domain)) return site
  }
  return null
}

/** True when the person has an active connection for this site. Pure over the connection list. */
// These apps sign in with a one-time code to the person's phone, so a saved phone number alone (via 'vault')
// still needs a fresh code on every visit (20 Oct live: a saved Zomato number counted as connected and the read
// spent 3 minutes at the code screen). Only a session the person signed into themselves counts.
export function isSiteConnected(connections: Array<{ siteId: string; status: string; via?: string }>, site: CatalogueSite): boolean {
  return connections.some(c => c.siteId === site.id && c.via !== 'vault' && !/^(?:revoked|expired|needs_reauth|human_challenge)$/i.test(String(c.status || '')))
}

function when(date?: string | null, time?: string | null) {
  const parts: string[] = []
  if (date) {
    const d = new Date(`${date}T12:00:00Z`)
    if (Number.isFinite(d.getTime())) parts.push(new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(d))
  }
  if (time && /^\d{2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(':').map(Number)
    parts.push(`${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`)
  }
  return parts.join(', ')
}

/** Approved mock, screen 2: connect the site once; nothing is booked. */
export function connectFirstReply(p: { site: CatalogueSite; restaurant: string; date?: string | null; time?: string | null; partySize?: number | null; providerUrl?: string | null }): string {
  const what = [p.partySize ? `table for ${p.partySize}` : 'a table', when(p.date, p.time)].filter(Boolean).join(', ')
  return [
    `${p.restaurant} takes bookings on ${p.site.name}, and ${p.site.name} only shows tables to a signed-in account. ${p.site.name} isn't signed in for me yet.`,
    '',
    `Connect it once: tap the link, enter your phone number in ${p.site.name}'s own page and type the code yourself. I never see or store the code.`,
    signInLink(p.site.id),
    '',
    `Then ask me again and I'll check ${what} and show you the best option before booking anything.${p.providerUrl ? `\nOr book it yourself here: ${p.providerUrl}` : ''}`,
  ].join('\n')
}

/** A booking reference shown on a provider's confirmation page ("Booking ID: TSAJKDX"). Pure. */
export function confirmationRefFrom(text: string): string | null {
  const m = String(text || '').match(/\b(?:booking|reservation|confirmation|order)\s*(?:id|no\.?|number|ref(?:erence)?|code|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,23})\b/i)
  return m ? m[1].toUpperCase() : null
}

// ---- Compare across booking apps (approved mock, screen 1) -------------------------------------------------
// Which apps list the venue and what each offers comes from public search results (no sign-in needed). The
// best option is then booked through the person's own signed-in app; nothing is booked without their yes.

export type BookingPlatform = { id: string; name: string; siteId: string | null; host: RegExp }
export const BOOKING_PLATFORMS: BookingPlatform[] = [
  { id: 'swiggy_dineout', name: 'Swiggy Dineout', siteId: 'swiggy', host: /(?:^|\.)swiggy\.com$/ },
  { id: 'district', name: 'District', siteId: 'district', host: /(?:^|\.)district\.in$/ },
  { id: 'zomato', name: 'Zomato', siteId: 'zomato', host: /(?:^|\.)zomato\.com$/ },
  { id: 'eazydiner', name: 'EazyDiner', siteId: 'eazydiner', host: /(?:^|\.)eazydiner\.com$/ },
  { id: 'magicpin', name: 'magicpin', siteId: null, host: /(?:^|\.)magicpin\.in$/ },
]

export type Offer = { percent: number; amount: number; label: string }
export type BookingOption = { platform: BookingPlatform; url: string; title: string; offer: Offer | null; connected: boolean }

export function platformForUrl(url: string): BookingPlatform | null {
  const h = hostOf(url).replace(/^www\./, '')
  return BOOKING_PLATFORMS.find(p => p.host.test(h)) || null
}

/** The discount a listing advertises ("Flat 20% off", "up to 25% off", "₹500 off"). Pure. */
export function offerFrom(text: string): Offer | null {
  const t = String(text || '').replace(/\s+/g, ' ')
  const pct = [...t.matchAll(/\b(flat|up\s*to|get|extra)?\s*(\d{1,2})\s*%\s*(?:off|discount|cashback)/gi)]
    .map(m => ({ percent: Number(m[2]), label: `${m[1] ? `${m[1].replace(/\s+/g, ' ').toLowerCase()} ` : ''}${m[2]}% off`.replace(/^up to/, 'up to').trim() }))
    .filter(o => o.percent > 0 && o.percent <= 60)
    .sort((a, b) => b.percent - a.percent)[0]
  const amt = t.match(/(?:₹|rs\.?\s*)(\d{2,4})\s*off/i)
  if (!pct && !amt) return null
  return { percent: pct?.percent || 0, amount: amt ? Number(amt[1]) : 0, label: pct?.label || `₹${amt![1]} off` }
}

/** One option per app, from search results that already name the venue. Pure. */
export function collectBookingOptions(results: Array<{ url: string; title?: string; snippet?: string }>, connectedSiteIds: string[]): BookingOption[] {
  const out: BookingOption[] = []
  for (const r of results || []) {
    const platform = platformForUrl(String(r.url || ''))
    if (!platform || out.some(o => o.platform.id === platform.id)) continue
    // Swiggy only counts for its Dineout (table) pages, not food delivery.
    if (platform.id === 'swiggy_dineout' && !/\/dineout\b/i.test(String(r.url))) continue
    out.push({ platform, url: String(r.url), title: String(r.title || ''), offer: offerFrom(`${r.title || ''} ${r.snippet || ''}`), connected: !!platform.siteId && connectedSiteIds.includes(platform.siteId) })
  }
  return out
}

/** Best first: biggest discount, then an app the person already signed into, then the usual app order. Pure. */
export function rankBookingOptions(options: BookingOption[]): BookingOption[] {
  const order = (o: BookingOption) => BOOKING_PLATFORMS.findIndex(p => p.id === o.platform.id)
  return [...options].sort((a, b) =>
    (b.offer?.percent || 0) - (a.offer?.percent || 0)
    || (b.offer?.amount || 0) - (a.offer?.amount || 0)
    || Number(b.connected) - Number(a.connected)
    || order(a) - order(b))
}

/** Compare card for WhatsApp: every app with its offer, the best marked, and the next step. Pure. */
export function bookingOptionsReply(p: { restaurant: string; date?: string | null; time?: string | null; partySize?: number | null; ranked: BookingOption[] }): string {
  const best = p.ranked[0]
  const head = `${p.restaurant} · ${[p.partySize ? `${p.partySize} guests` : '', when(p.date, p.time)].filter(Boolean).join(' · ')}`
  const lines = p.ranked.slice(0, 5).map((o, i) => `${i === 0 ? '⭐' : '•'} ${o.platform.name}: ${o.offer ? o.offer.label : 'no offer listed'}${o.connected ? ' · signed in' : ''}`)
  const next = best.connected
    ? `Best: ${best.platform.name}${best.offer ? ` (${best.offer.label})` : ''}. Checking live tables there now; I'll ask before booking.`
    : `Best: ${best.platform.name}${best.offer ? ` (${best.offer.label})` : ''}. To book it, sign in to ${best.platform.name} once (you type the code; I never see it), then ask again:\n${signInLink(best.platform.siteId)}\nOr book it yourself: ${best.url}`
  return [`*${head}*`, ...lines, '', next, '', 'Offers are as listed on each app today; the final bill discount is applied by the app.'].join('\n')
}


/** Visible text of a public listing page (no sign-in, no browser): tags, scripts and styles removed. Pure. */
export function listingText(html: string): string {
  // Many listing pages render offers from embedded page data (Next.js __NEXT_DATA__, JSON-LD), not visible HTML.
  // Only short string values that themselves read like an offer are kept from those blocks.
  const embedded = [...String(html || '').matchAll(/<script[^>]*(?:id="__NEXT_DATA__"|type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(m => [...m[1].matchAll(/"([^"\\]{3,120}(?:\d{1,2}\s*%\s*(?:off|discount|cashback)|(?:₹|rs\.?\s*)\d{2,4}\s*off)[^"\\]{0,60})"/gi)].map(x => x[1]))
    .slice(0, 20).join(' · ')
  return (embedded + ' ' + String(html || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/\s+/g, ' ').trim().slice(0, 60000)
}

/**
 * The offer on each app's public listing page, read with a plain GET (6s, no cookies, no sign-in). Search snippets
 * rarely carry the discount (20 Oct live: four apps found, no offers). Pages that need JS or block bots just keep
 * the snippet result. Never throws.
 */
export async function enrichOffersFromListings(options: BookingOption[], fetchImpl: typeof fetch = fetch): Promise<BookingOption[]> {
  return Promise.all(options.map(async o => {
    if (o.offer) return o
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), 6000) : null
      const res = await fetchImpl(o.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; AskGogo/1.0)', accept: 'text/html' }, redirect: 'follow', signal: controller?.signal } as any)
      if (timer) clearTimeout(timer)
      if (!res.ok) return o
      const offer = offerFrom(listingText(await res.text()))
      return offer ? { ...o, offer } : o
    } catch { return o }
  }))
}
