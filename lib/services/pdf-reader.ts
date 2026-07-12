import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface FlightInfo {
  type: 'flight'
  flights: Array<{
    from: string
    to: string
    date: string
    departure: string
    arrival: string
    airline: string
    flightNo: string
    pnr: string
  }>
  passengers: string[]
}

export interface TrainInfo {
  type: 'train'
  from: string
  to: string
  date: string
  departure: string
  trainNo: string
  trainName: string
  pnr: string
  passengers: string[]
}

export interface EventInfo {
  type: 'event'
  name: string
  date: string
  time: string
  venue: string
}

export type TicketInfo = FlightInfo | TrainInfo | EventInfo | null

/**
 * Download PDF from Twilio URL and parse it using Claude's native PDF support
 */
export async function parsePdfTicket(
  mediaUrl: string,
  accountSid: string,
  authToken: string
): Promise<TicketInfo> {
  console.log('[pdf-reader] Fetching PDF from Twilio:', mediaUrl)

  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
    },
  })

  if (!response.ok) {
    console.error('[pdf-reader] Failed to fetch PDF:', response.status, response.statusText)
    throw new Error(`Failed to fetch PDF: ${response.status}`)
  }

  const pdfBuffer = await response.arrayBuffer()
  const base64Pdf = Buffer.from(pdfBuffer).toString('base64')
  console.log('[pdf-reader] PDF fetched, bytes:', pdfBuffer.byteLength)

  // Use Claude's native PDF document support — works on both text and image-based PDFs
  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf,
            },
          } as never,
          {
            type: 'text',
            text: `Extract all travel details from this ticket and return ONLY valid JSON. No markdown, no explanation.

If FLIGHT:
{"type":"flight","flights":[{"from":"City","to":"City","date":"15 May 2026","departure":"14:50","arrival":"17:15","airline":"IndiGo","flightNo":"6E123","pnr":"XCDZFN"}],"passengers":["Full Name"]}

If TRAIN:
{"type":"train","from":"City","to":"City","date":"15 May 2026","departure":"14:50","trainNo":"12345","trainName":"Train Name","pnr":"ABC123","passengers":["Name"]}

If EVENT:
{"type":"event","name":"Event Name","date":"15 May 2026","time":"18:00","venue":"Venue"}

Extract ALL flights for round-trips. Extract ALL passenger names. Return ONLY the JSON.`,
          },
        ],
      },
    ],
  })

  const text = result.content[0]?.type === 'text' ? result.content[0].text.trim() : ''
  const clean = text.replace(/```json|```/g, '').trim()
  console.log('[pdf-reader] Claude response:', clean.slice(0, 400))

  try {
    return JSON.parse(clean) as TicketInfo
  } catch {
    console.error('[pdf-reader] JSON parse failed:', clean)
    return null
  }
}

/**
 * Build the WhatsApp reply for a parsed ticket
 */
export function buildTicketReply(info: TicketInfo, reminderSet = true): string {
  if (!info)
    return "📄 I received your PDF but couldn't extract travel details. Is this a flight, train, or event ticket?"

  if (info.type === 'flight') {
    const fi = info as FlightInfo
    const flightLines = fi.flights
      .map(
        (f) =>
          `✈️ *${f.from} → ${f.to}*\n` +
          `${f.date} · ${f.departure} → ${f.arrival}\n` +
          `${f.airline} ${f.flightNo} · PNR: \`${f.pnr}\``
      )
      .join('\n\n')
    const pax = fi.passengers.length > 0 ? `\n\n👥 *Passengers:* ${fi.passengers.join(', ')}` : ''
    const reminder = reminderSet ? `\n\n⏰ *Reminders set* — I'll alert you *3 hours before* each departure!` : ''
    return `🎫 *Flight ticket saved!*\n\n${flightLines}${pax}${reminder}\n\n_Say *my reminders* to see all alerts_`
  }

  if (info.type === 'train') {
    const ti = info as TrainInfo
    const pax = ti.passengers.length > 0 ? `\n👥 ${ti.passengers.join(', ')}` : ''
    const reminder = reminderSet ? '\n\n⏰ *Reminder set* — 3 hours before departure!' : ''
    return `🚆 *Train ticket saved!*\n\n*${ti.from} → ${ti.to}*\n${ti.date} · ${ti.departure}\n${ti.trainName} (${ti.trainNo}) · PNR: \`${ti.pnr}\`${pax}${reminder}\n\n_Say *my reminders* to see all alerts_`
  }

  if (info.type === 'event') {
    const ei = info as EventInfo
    const reminder = reminderSet ? '\n\n⏰ *Reminder set* — 3 hours before the event!' : ''
    return `🎟️ *Event ticket saved!*\n\n*${ei.name}*\n${ei.date} · ${ei.time}\n📍 ${ei.venue}${reminder}\n\n_Say *my reminders* to see all alerts_`
  }

  return '📄 Ticket saved to your notes!'
}

/**
 * Parse date + time string → reminder Date (3 hours before)
 */
export function getReminderTime(dateStr: string, timeStr: string): Date | null {
  try {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    }
    const parts = dateStr.toLowerCase().replace(/,/g, '').split(/\s+/)
    const day = parseInt(parts[0])
    const month = months[parts[1]?.slice(0, 3)] ?? -1
    const year = parseInt(parts[2])
    const [h, m] = timeStr.split(':').map(Number)
    if (isNaN(day) || month < 0 || isNaN(year) || isNaN(h)) return null
    // Ticket times are local wall-clock (IST). Build the UTC instant explicitly so
    // the reminder is correct regardless of the server's timezone (Vercel runs in UTC).
    const departure = new Date(Date.UTC(year, month, day, h - 5, (m || 0) - 30, 0, 0))
    return new Date(departure.getTime() - 3 * 60 * 60 * 1000)
  } catch {
    return null
  }
}
