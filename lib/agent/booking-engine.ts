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
export function isSiteConnected(connections: Array<{ siteId: string; status: string }>, site: CatalogueSite): boolean {
  return connections.some(c => c.siteId === site.id && !/^(?:revoked|expired|needs_reauth|human_challenge)$/i.test(String(c.status || '')))
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
    `${p.restaurant} takes bookings on ${p.site.name}, and ${p.site.name} only shows tables to a signed-in account. ${p.site.name} isn't connected yet.`,
    '',
    `Connect it once: open Settings, tap Sign in next to ${p.site.name}, enter your phone number and type the code yourself. I never see or store the code.`,
    CONNECTIONS_SETTINGS_URL,
    '',
    `Then ask me again and I'll check ${what} and show you the best option before booking anything.${p.providerUrl ? `\nOr book it yourself here: ${p.providerUrl}` : ''}`,
  ].join('\n')
}

/** A booking reference shown on a provider's confirmation page ("Booking ID: TSAJKDX"). Pure. */
export function confirmationRefFrom(text: string): string | null {
  const m = String(text || '').match(/\b(?:booking|reservation|confirmation|order)\s*(?:id|no\.?|number|ref(?:erence)?|code|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,23})\b/i)
  return m ? m[1].toUpperCase() : null
}
