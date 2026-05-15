import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

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
 * Extract plain text from PDF buffer using pdf-parse
 */
async function extractPdfText(pdfBuffer: ArrayBuffer): Promise<string> {
  try {
    // Dynamically import pdf-parse to avoid issues with Next.js bundling
    const pdfParse = (await import('pdf-parse')).default
    const data = await pdfParse(Buffer.from(pdfBuffer))
    return data.text || ''
  } catch (err) {
    console.error('[pdf-reader] pdf-parse failed:', err)
    return ''
  }
}

/**
 * Download PDF from Twilio URL, extract text, then parse with GPT-4o
 */
export async function parsePdfTicket(
  mediaUrl: string,
  accountSid: string,
  authToken: string
): Promise<TicketInfo> {
  // 1. Fetch PDF from Twilio with auth
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
    },
  })

  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`)

  const pdfBuffer = await response.arrayBuffer()

  // 2. Extract text from PDF server-side
  const pdfText = await extractPdfText(pdfBuffer)

  if (!pdfText || pdfText.trim().length < 20) {
    console.error('[pdf-reader] Could not extract text from PDF — possibly scanned/image PDF')
    return null
  }

  console.log('[pdf-reader] Extracted PDF text length:', pdfText.length)
  console.log('[pdf-reader] First 500 chars:', pdfText.slice(0, 500))

  // 3. Send extracted text to GPT-4o for structured parsing
  const result = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    messages: [
      {
        role: 'system',
        content: `You are a travel ticket parser. Extract travel details from the provided ticket text and return ONLY valid JSON. No markdown, no explanation.`,
      },
      {
        role: 'user',
        content: `Parse this travel ticket and return JSON.

If FLIGHT:
{"type":"flight","flights":[{"from":"City name","to":"City name","date":"2 Jul 2026","departure":"14:50","arrival":"17:15","airline":"Airline name","flightNo":"QP1423","pnr":"XCDZFN"}],"passengers":["Full Name 1"]}

If TRAIN:
{"type":"train","from":"City","to":"City","date":"2 Jul 2026","departure":"14:50","trainNo":"12345","trainName":"Train Name","pnr":"ABC123","passengers":["Name 1"]}

If EVENT:
{"type":"event","name":"Event Name","date":"2 Jul 2026","time":"18:00","venue":"Venue Name"}

Rules:
- Extract ALL flights if round-trip or multi-city
- Extract ALL passenger names
- Use the exact dates and times from the ticket
- Return ONLY the JSON object, nothing else

TICKET TEXT:
${pdfText.slice(0, 8000)}`,
      },
    ],
  })

  const text = result.choices[0]?.message?.content?.trim() || ''
  const clean = text.replace(/```json|```/g, '').trim()

  console.log('[pdf-reader] GPT-4o response:', clean.slice(0, 300))

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

    const pax =
      fi.passengers.length > 0 ? `\n\n👥 *Passengers:* ${fi.passengers.join(', ')}` : ''

    const reminder = reminderSet
      ? `\n\n⏰ *Reminders set* — I'll alert you *3 hours before* each departure!`
      : ''

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
 * Parse "2 Jul 2026 14:50" → Date object minus 3 hours
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

    const departure = new Date(year, month, day, h, m, 0, 0)
    const reminderTime = new Date(departure.getTime() - 3 * 60 * 60 * 1000)
    return reminderTime
  } catch {
    return null
  }
}
