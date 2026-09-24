import {
  parsePdfTicket as parsePdfTicketWithProviderFallback,
  parseImageTicket,
  classifyPdfDocument,
  readAndSummarizePdfDocument,
  type TicketInfo,
  type FlightInfo,
  type PdfClass,
} from './pdf-reader'

export { parseImageTicket, classifyPdfDocument, readAndSummarizePdfDocument }
export type { PdfClass, TicketInfo, FlightInfo, TrainInfo, EventInfo } from './pdf-reader'

const AIRPORT_CITY: Record<string, string> = {
  BLR: 'Bengaluru',
  AUH: 'Abu Dhabi',
  JFK: 'New York',
  DEL: 'Delhi',
  BOM: 'Mumbai',
  DXB: 'Dubai',
  LHR: 'London',
  SIN: 'Singapore',
}

function airlineNameFromPrefix(prefix: string): string {
  const key = String(prefix || '').toUpperCase()
  if (key === 'EY') return 'Etihad'
  if (key === 'AI') return 'Air India'
  if (key === '6E') return 'IndiGo'
  if (key === 'EK') return 'Emirates'
  return key
}

function addUniqueFlight(
  out: Array<{ prefix: string; number: string }>,
  seen: Set<string>,
  prefix: string,
  number: string,
) {
  const normalizedPrefix = prefix.toUpperCase()
  const key = normalizedPrefix + number
  if (seen.has(key)) return
  seen.add(key)
  out.push({ prefix: normalizedPrefix, number })
}

/**
 * Deterministic text-ticket parser used by the WhatsApp PDF ingestion path.
 * Explicit carrier lines win over broad IATA-like tokens so aircraft models such
 * as Airbus A350-1000 can never shift the leg-to-flight assignment.
 */
export function parseFlightTicketTextSafe(text: string): FlightInfo | null {
  const raw = String(text || '').replace(/\r/g, ' ').replace(/[ \t]+/g, ' ').trim()
  if (!raw) return null

  const pnr = raw.match(/\b(?:booking\s*reference|pnr)\s*[:#-]?\s*([A-Z0-9]{5,8})\b/i)?.[1]?.toUpperCase()
  if (!pnr) return null

  const passengerMatch = raw.match(/(?:^|\n)\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s*(?:\n|\s)+Thank you for your booking/i)
  const passengers = passengerMatch?.[1] ? [passengerMatch[1].trim()] : []

  const flightNos: Array<{ prefix: string; number: string }> = []
  const seen = new Set<string>()

  // Strong signal: itinerary rows such as "EY 239 • Etihad" / "EY 1 · Etihad".
  for (const m of raw.matchAll(/\b([A-Z0-9]{2})\s*([0-9]{1,4})\s*[•·]\s*[A-Z][A-Za-z]+/g)) {
    if (!/[A-Z]/.test(m[1])) continue
    addUniqueFlight(flightNos, seen, m[1], m[2])
    if (flightNos.length >= 12) break
  }

  // Fallback for tickets without an airline-name separator. Reject tokens directly
  // preceded by aircraft labels so A350/B787-style model names are never flights.
  if (!flightNos.length) {
    for (const m of raw.matchAll(/\b([A-Z0-9]{2})\s*([0-9]{1,4})\b/g)) {
      const prefix = m[1].toUpperCase()
      if (!/[A-Z]/.test(prefix)) continue
      const before = raw.slice(Math.max(0, (m.index || 0) - 28), m.index || 0).toLowerCase()
      if (/(?:airbus|boeing|aircraft|dreamliner)\s*$/.test(before)) continue
      addUniqueFlight(flightNos, seen, prefix, m[2])
      if (flightNos.length >= 12) break
    }
  }

  const legs: FlightInfo['flights'] = []
  const legRe = /\b([A-Z]{3})\s+(\d{1,2}:\d{2})\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})[\s\S]{0,260}?\b([A-Z]{3})\s+(\d{1,2}:\d{2})\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/g
  let match: RegExpExecArray | null
  while ((match = legRe.exec(raw)) && legs.length < 8) {
    const fromCode = match[1].toUpperCase()
    const toCode = match[4].toUpperCase()
    if (fromCode === toCode) continue
    const flight = flightNos[legs.length] || flightNos[0]
    if (!flight) continue
    legs.push({
      from: AIRPORT_CITY[fromCode] || fromCode,
      to: AIRPORT_CITY[toCode] || toCode,
      date: match[3].replace(/\s+/g, ' ').trim(),
      departure: match[2],
      arrival: match[5],
      airline: airlineNameFromPrefix(flight.prefix),
      flightNo: `${flight.prefix}${flight.number}`,
      pnr,
    })
  }

  if (!legs.length) return null
  return { type: 'flight', flights: legs, passengers }
}

async function fetchTwilioPdfBuffer(mediaUrl: string, accountSid: string, authToken: string): Promise<Buffer> {
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
    },
  })
  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  try {
    const mod: any = await import('pdf-parse')
    if (typeof mod.PDFParse === 'function') {
      const parser = new mod.PDFParse({ data: pdfBuffer })
      try {
        const result = await parser.getText()
        return String(result?.text || '').trim()
      } finally {
        await parser.destroy?.()
      }
    }
    const legacy = mod.default || mod
    if (typeof legacy === 'function') {
      const result = await legacy(pdfBuffer)
      return String(result?.text || '').trim()
    }
  } catch (error: any) {
    console.warn('[pdf-reader-whatsapp] local text extraction failed:', error?.message || error)
  }
  return ''
}

/**
 * WhatsApp-safe PDF ticket entry point. Text e-tickets are parsed locally first;
 * image-heavy/ambiguous PDFs retain the existing provider-backed fallback.
 */
export async function parsePdfTicket(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
): Promise<TicketInfo> {
  const pdfBuffer = await fetchTwilioPdfBuffer(mediaUrl, accountSid, authToken)
  const localText = await extractPdfText(pdfBuffer)
  const local = parseFlightTicketTextSafe(localText)
  if (local) {
    console.log('[pdf-reader-whatsapp] local ticket parse succeeded:', local.flights.length, 'legs')
    return local
  }
  return parsePdfTicketWithProviderFallback(mediaUrl, accountSid, authToken)
}

