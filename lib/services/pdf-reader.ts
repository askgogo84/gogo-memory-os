import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export interface FlightInfo {
  type: 'flight'
  flights: Array<{
    from: string
    to: string
    date: string        // "2 Jul 2026"
    departure: string   // "14:50"
    arrival: string     // "17:15"
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
 * Download PDF from Twilio URL and extract text via GPT-4o
 */
export async function parsePdfTicket(mediaUrl: string, accountSid: string, authToken: string): Promise<TicketInfo> {
  // Fetch PDF from Twilio with auth
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    }
  })

  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`)

  const pdfBuffer = await response.arrayBuffer()
  const base64Pdf = Buffer.from(pdfBuffer).toString('base64')

  // Use GPT-4o with PDF as document
  const result = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Extract all travel details from this ticket PDF. Return ONLY valid JSON, no markdown.

If it's a FLIGHT ticket:
{"type":"flight","flights":[{"from":"City name","to":"City name","date":"2 Jul 2026","departure":"14:50","arrival":"17:15","airline":"Airline name","flightNo":"QP1423","pnr":"XCDZFN"}],"passengers":["Full Name 1","Full Name 2"]}

If it's a TRAIN ticket:
{"type":"train","from":"City","to":"City","date":"2 Jul 2026","departure":"14:50","trainNo":"12345","trainName":"Train Name","pnr":"ABC123","passengers":["Name 1"]}

If it's an EVENT ticket:
{"type":"event","name":"Event Name","date":"2 Jul 2026","time":"18:00","venue":"Venue Name"}

Extract ALL flights if round-trip. Extract ALL passenger names.`
        },
        {
          type: 'text',
          text: `PDF content (base64): data:application/pdf;base64,${base64Pdf.slice(0, 50000)}`
        }
      ]
    }]
  })

  const text = result.choices[0]?.message?.content?.trim() || ''
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(clean) as TicketInfo
  } catch {
    return null
  }
}

/**
 * Build the WhatsApp reply for a parsed ticket
 */
export function buildTicketReply(info: TicketInfo, reminderSet = true): string {
  if (!info) return '📄 I received your PDF but couldn\'t extract travel details. Is this a flight, train, or event ticket?'

  if (info.type === 'flight') {
    const fi = info as FlightInfo
    const flightLines = fi.flights.map(f =>
      `✈️ *${f.from} → ${f.to}*\n` +
      `${f.date} · ${f.departure} → ${f.arrival}\n` +
      `${f.airline} ${f.flightNo} · PNR: \`${f.pnr}\``
    ).join('\n\n')

    const pax = fi.passengers.length > 0
      ? `\n\n👥 *Passengers:* ${fi.passengers.join(', ')}`
      : ''

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
      jan:0,feb:1,mar:2,apr:3,may:4,jun:5,
      jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
    }
    const parts = dateStr.toLowerCase().replace(/,/g,'').split(/\s+/)
    const day = parseInt(parts[0])
    const month = months[parts[1]?.slice(0,3)] ?? -1
    const year = parseInt(parts[2])
    const [h, m] = timeStr.split(':').map(Number)

    if (isNaN(day) || month < 0 || isNaN(year) || isNaN(h)) return null

    const departure = new Date(year, month, day, h, m, 0, 0)
    const reminderTime = new Date(departure.getTime() - 3 * 60 * 60 * 1000)
    return reminderTime
  } catch { return null }
}
