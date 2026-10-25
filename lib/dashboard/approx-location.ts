// Approximate location for the dashboard chat. The person opts in; the browser keeps the choice and a rounded
// position (about 1 km, two decimals) and attaches it to a message only when sending. Nothing is stored on the
// server. Pure functions so the chat, the API routes and the tests agree on what counts as a valid position.
export const LOCATION_STORAGE_KEY = 'gogo.location.v1'
/** A saved position older than this is refreshed quietly the next time the page opens. */
export const LOCATION_MAX_AGE_MS = 12 * 60 * 60 * 1000

export type ApproxLocation = { lat: number; lon: number }
export type LocationPreference = { status: 'ask' | 'on' | 'off'; lat?: number; lon?: number; label?: string; at?: number }

/** Two decimals is roughly a kilometre: enough for weather and "nearby", too coarse to find a street. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100
}

/** A valid, rounded position, or null. Anything the browser or a caller sends is checked here first. */
export function parseApproxLocation(raw: unknown): ApproxLocation | null {
  if (!raw || typeof raw !== 'object') return null
  const lat = Number((raw as any).lat)
  const lon = Number((raw as any).lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat: roundCoordinate(lat), lon: roundCoordinate(lon) }
}

export function parseLocationPreference(stored: string | null | undefined): LocationPreference {
  if (!stored) return { status: 'ask' }
  try {
    const value = JSON.parse(stored)
    if (value?.status === 'off') return { status: 'off' }
    if (value?.status === 'on') {
      const position = parseApproxLocation(value)
      if (!position) return { status: 'ask' }
      return {
        status: 'on', ...position,
        label: typeof value.label === 'string' ? value.label.slice(0, 80) : undefined,
        at: Number.isFinite(Number(value.at)) ? Number(value.at) : undefined,
      }
    }
  } catch { /* unreadable: ask again */ }
  return { status: 'ask' }
}

export function locationIsStale(pref: LocationPreference, now: number): boolean {
  return pref.status === 'on' && (!pref.at || now - pref.at > LOCATION_MAX_AGE_MS)
}

/** The "lat,lon" text the weather service accepts as a place. */
export function locationQuery(location: ApproxLocation): string {
  return `${location.lat},${location.lon}`
}

/** What the card and the side panel say about the saved position. */
export function locationTag(pref: LocationPreference): string {
  if (pref.status !== 'on') return ''
  return pref.label ? `${pref.label} (approx.)` : 'Approximate location'
}
