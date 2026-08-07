/**
 * Airline check-in lookup for the flight-ticket reminder flow.
 *
 * WHY THE BARE DOMAIN IS THE DEFAULT
 * Deep check-in paths break silently when an airline redesigns, and several
 * carriers put the locale in the path (emirates.com/us/english/..., 
 * lufthansa.com/us/en/...) so one stored path can serve the wrong region.
 * A broken link inside a reminder is worse than one extra tap, so `site` is
 * always safe and `checkInUrl` is the optional enhancement.
 *
 * Only set checkInUrlVerified: true after loading the URL yourself and
 * landing on a real check-in form. Never let an agent generate these.
 *
 * checkInOpensHours drives WHEN the reminder fires. It is NOT 24h for most
 * carriers — every Indian airline opens at 48h.
 *
 * Re-verify every 6 months, or whenever a user reports a dead link.
 */

export type Airline = {
  /** IATA code as parsed off the ticket */
  code: string
  name: string
  /** Bare domain — always safe, opens the app via universal links if installed */
  site: string
  /** Deep link to the check-in form. Falls back to `site` when unverified. */
  checkInUrl?: string
  checkInUrlVerified: boolean
  /** Hours before departure that check-in opens. null = unknown, use 24h default. */
  checkInOpensHours: number | null
  /** Set when the international window differs from the domestic one. */
  checkInOpensHoursIntl?: number
  notes?: string
}

export const AIRLINES: Record<string, Airline> = {
  // ── India ────────────────────────────────────────────────────────────
  '6E': {
    code: '6E',
    name: 'IndiGo',
    site: 'https://www.goindigo.in',
    checkInUrl: 'https://www.goindigo.in/web-check-in.html',
    checkInUrlVerified: true,
    checkInOpensHours: 48,
    checkInOpensHoursIntl: 24,
    notes: 'Domestic 48h–60min. International 24h–75min. Web check-in is mandatory for domestic.',
  },
  AI: {
    code: 'AI',
    name: 'Air India',
    site: 'https://www.airindia.com',
    checkInUrl: 'https://www.airindia.com/in/en/manage/web-checkin.html',
    checkInUrlVerified: true,
    checkInOpensHours: 48,
    notes: 'Closes 1h before domestic, 2h before international. Not available on codeshare flights.',
  },
  IX: {
    code: 'IX',
    name: 'Air India Express',
    site: 'https://www.airindiaexpress.com',
    checkInUrl: 'https://www.airindiaexpress.com/checkin-home',
    checkInUrlVerified: true,
    checkInOpensHours: 48,
  },
  QP: {
    code: 'QP',
    name: 'Akasa Air',
    site: 'https://www.akasaair.com',
    checkInUrlVerified: false,
    checkInOpensHours: 48,
    notes: 'Closes 75min domestic / 90min intl. Charges an airport check-in fee if you skip web check-in.',
  },
  SG: {
    code: 'SG',
    name: 'SpiceJet',
    site: 'https://www.spicejet.com',
    checkInUrlVerified: false,
    checkInOpensHours: 48,
    notes: 'Closes 60min before departure.',
  },
  '9I': {
    code: '9I',
    name: 'Alliance Air',
    site: 'https://www.allianceair.in',
    checkInUrlVerified: false,
    checkInOpensHours: null,
  },
  UK: {
    code: 'UK',
    name: 'Vistara (merged into Air India)',
    site: 'https://www.airindia.com',
    checkInUrlVerified: false,
    checkInOpensHours: 48,
    notes: 'VERIFY: Vistara merged into Air India. Old UK-coded tickets should route to Air India.',
  },

  // ── Gulf ─────────────────────────────────────────────────────────────
  EK: {
    code: 'EK',
    name: 'Emirates',
    site: 'https://www.emirates.com',
    checkInUrlVerified: false,
    checkInOpensHours: 48,
    notes: 'Locale sits in the path (/us/english/, /in/english/). Verify the India locale before deep-linking. Closes 90min before departure.',
  },
  EY: {
    code: 'EY',
    name: 'Etihad Airways',
    site: 'https://www.etihad.com',
    checkInUrl: 'https://www.etihad.com/en/manage/check-in',
    checkInUrlVerified: true,
    checkInOpensHours: null,
  },
  QR: {
    code: 'QR',
    name: 'Qatar Airways',
    site: 'https://www.qatarairways.com',
    checkInUrlVerified: false,
    checkInOpensHours: null,
    notes: 'Locale in path (/en-us/, /en-in/). Verify the India locale.',
  },
  FZ: { code: 'FZ', name: 'flydubai', site: 'https://www.flydubai.com', checkInUrlVerified: false, checkInOpensHours: null },
  G9: { code: 'G9', name: 'Air Arabia', site: 'https://www.airarabia.com', checkInUrlVerified: false, checkInOpensHours: null },
  WY: { code: 'WY', name: 'Oman Air', site: 'https://www.omanair.com', checkInUrlVerified: false, checkInOpensHours: null },
  GF: { code: 'GF', name: 'Gulf Air', site: 'https://www.gulfair.com', checkInUrlVerified: false, checkInOpensHours: null },
  SV: { code: 'SV', name: 'Saudia', site: 'https://www.saudia.com', checkInUrlVerified: false, checkInOpensHours: null },
  KU: { code: 'KU', name: 'Kuwait Airways', site: 'https://www.kuwaitairways.com', checkInUrlVerified: false, checkInOpensHours: null },

  // ── Asia-Pacific ─────────────────────────────────────────────────────
  SQ: {
    code: 'SQ',
    name: 'Singapore Airlines',
    site: 'https://www.singaporeair.com',
    checkInUrlVerified: false,
    checkInOpensHours: 48,
    notes: 'Closes ~1.5h before departure.',
  },
  TG: { code: 'TG', name: 'Thai Airways', site: 'https://www.thaiairways.com', checkInUrlVerified: false, checkInOpensHours: null },
  MH: { code: 'MH', name: 'Malaysia Airlines', site: 'https://www.malaysiaairlines.com', checkInUrlVerified: false, checkInOpensHours: null },
  AK: { code: 'AK', name: 'AirAsia', site: 'https://www.airasia.com', checkInUrlVerified: false, checkInOpensHours: null },
  TR: { code: 'TR', name: 'Scoot', site: 'https://www.flyscoot.com', checkInUrlVerified: false, checkInOpensHours: null },
  CX: { code: 'CX', name: 'Cathay Pacific', site: 'https://www.cathaypacific.com', checkInUrlVerified: false, checkInOpensHours: null },
  VN: { code: 'VN', name: 'Vietnam Airlines', site: 'https://www.vietnamairlines.com', checkInUrlVerified: false, checkInOpensHours: null },
  UL: { code: 'UL', name: 'SriLankan Airlines', site: 'https://www.srilankan.com', checkInUrlVerified: false, checkInOpensHours: null },
  NH: { code: 'NH', name: 'ANA', site: 'https://www.ana.co.jp', checkInUrlVerified: false, checkInOpensHours: null },
  JL: { code: 'JL', name: 'Japan Airlines', site: 'https://www.jal.co.jp', checkInUrlVerified: false, checkInOpensHours: null },
  KE: { code: 'KE', name: 'Korean Air', site: 'https://www.koreanair.com', checkInUrlVerified: false, checkInOpensHours: null },
  QF: { code: 'QF', name: 'Qantas', site: 'https://www.qantas.com', checkInUrlVerified: false, checkInOpensHours: null },

  // ── Europe ───────────────────────────────────────────────────────────
  LH: {
    code: 'LH',
    name: 'Lufthansa',
    site: 'https://www.lufthansa.com',
    checkInUrlVerified: false,
    checkInOpensHours: 23,
    notes: 'Opens 23h, not 24h. Locale in path (/us/en/, /in/en/) — verify the India locale.',
  },
  BA: { code: 'BA', name: 'British Airways', site: 'https://www.britishairways.com', checkInUrlVerified: false, checkInOpensHours: 24 },
  AF: { code: 'AF', name: 'Air France', site: 'https://www.airfrance.com', checkInUrlVerified: false, checkInOpensHours: null },
  KL: { code: 'KL', name: 'KLM', site: 'https://www.klm.com', checkInUrlVerified: false, checkInOpensHours: null },
  TK: { code: 'TK', name: 'Turkish Airlines', site: 'https://www.turkishairlines.com', checkInUrlVerified: false, checkInOpensHours: null },
  LX: { code: 'LX', name: 'SWISS', site: 'https://www.swiss.com', checkInUrlVerified: false, checkInOpensHours: null },
  VS: { code: 'VS', name: 'Virgin Atlantic', site: 'https://www.virginatlantic.com', checkInUrlVerified: false, checkInOpensHours: null },

  // ── Americas ─────────────────────────────────────────────────────────
  UA: { code: 'UA', name: 'United Airlines', site: 'https://www.united.com', checkInUrlVerified: false, checkInOpensHours: 24 },
  DL: { code: 'DL', name: 'Delta Air Lines', site: 'https://www.delta.com', checkInUrlVerified: false, checkInOpensHours: 24 },
  AA: { code: 'AA', name: 'American Airlines', site: 'https://www.aa.com', checkInUrlVerified: false, checkInOpensHours: 24 },
  AC: { code: 'AC', name: 'Air Canada', site: 'https://www.aircanada.com', checkInUrlVerified: false, checkInOpensHours: 24 },

  // ── Africa ───────────────────────────────────────────────────────────
  ET: { code: 'ET', name: 'Ethiopian Airlines', site: 'https://www.ethiopianairlines.com', checkInUrlVerified: false, checkInOpensHours: null },
}

/** Default when the airline isn't in the table or its window is unknown. */
export const DEFAULT_CHECKIN_OPENS_HOURS = 24

/**
 * The link to put in the T-minus check-in reminder.
 * Returns null when the airline is unknown — send the reminder without a link
 * rather than guessing a URL.
 */
export function checkInLink(airlineCode?: string | null): string | null {
  if (!airlineCode) return null
  const a = AIRLINES[airlineCode.toUpperCase()]
  if (!a) return null
  return a.checkInUrlVerified && a.checkInUrl ? a.checkInUrl : a.site
}

/**
 * How many hours before departure the check-in reminder should fire.
 * `isInternational` picks the intl window where the airline has a different one.
 */
export function checkInOpensHours(
  airlineCode?: string | null,
  isInternational = false,
): number {
  if (!airlineCode) return DEFAULT_CHECKIN_OPENS_HOURS
  const a = AIRLINES[airlineCode.toUpperCase()]
  if (!a) return DEFAULT_CHECKIN_OPENS_HOURS
  if (isInternational && a.checkInOpensHoursIntl != null) return a.checkInOpensHoursIntl
  return a.checkInOpensHours ?? DEFAULT_CHECKIN_OPENS_HOURS
}

export function airlineName(airlineCode?: string | null): string | null {
  if (!airlineCode) return null
  return AIRLINES[airlineCode.toUpperCase()]?.name ?? null
}
