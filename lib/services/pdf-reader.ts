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
    seat?: string
  }>
  passengers: string[]
}

export interface TrainInfo {
  type: 'train'
  from: string
  to: string
  date: string
  departure: string
  arrival?: string
  trainNo: string
  trainName: string
  pnr: string
  seat?: string
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

// Shared extraction prompt for both PDF (document) and image (photo) tickets.
const TICKET_EXTRACT_PROMPT = `Extract all travel details from this ticket and return ONLY valid JSON. No markdown, no explanation.

If FLIGHT:
{"type":"flight","flights":[{"from":"City","to":"City","date":"15 May 2026","departure":"14:50","arrival":"17:15","airline":"IndiGo","flightNo":"6E123","pnr":"XCDZFN","seat":"14C"}],"passengers":["Full Name"]}

If TRAIN:
{"type":"train","from":"City","to":"City","date":"15 May 2026","departure":"14:50","arrival":"20:10","trainNo":"12345","trainName":"Train Name","pnr":"ABC123","seat":"B2-34","passengers":["Name"]}

If EVENT:
{"type":"event","name":"Event Name","date":"15 May 2026","time":"18:00","venue":"Venue"}

Extract ALL flights for round-trips. Extract ALL passenger names. Include seat and arrival when present (omit the field if unknown). Return ONLY the JSON. If this is NOT a flight, train, or event ticket, return exactly: null`

function parseTicketJson(text: string): TicketInfo {
  const clean = text.replace(/```json|```/g, '').trim()
  console.log('[ticket-reader] Claude response:', clean.slice(0, 400))
  if (!clean || clean.toLowerCase() === 'null') return null
  try {
    return JSON.parse(clean) as TicketInfo
  } catch {
    console.error('[ticket-reader] JSON parse failed:', clean)
    return null
  }
}

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
            text: TICKET_EXTRACT_PROMPT,
          },
        ],
      },
    ],
  })

  const text = result.content[0]?.type === 'text' ? result.content[0].text.trim() : ''
  return parseTicketJson(text)
}

// Download a Twilio-hosted PDF and return it base64-encoded. Shared by the
// classifier and the summariser below (the ticket parser above inlines the same
// fetch; left untouched to keep this change scoped to the new document path).
async function fetchTwilioPdfBase64(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
): Promise<string> {
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
    },
  })
  if (!response.ok) {
    console.error('[pdf-reader] Failed to fetch PDF:', response.status, response.statusText)
    throw new Error(`Failed to fetch PDF: ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer()).toString('base64')
}

export type PdfClass = 'TICKET' | 'DOCUMENT' | 'OTHER'

/**
 * Classify a PDF's first page so the webhook can route travel tickets to
 * parsePdfTicket and route everything else (leases, licences, bills, forms…) to
 * the summarise-and-save note path. This is the PDF analogue of the image
 * classifier already used in the webhook, generalised to a document content
 * block. Cheap Haiku call; defaults to DOCUMENT on any ambiguity so a non-ticket
 * is never forced down the travel-only parser. All active Claude models support
 * PDF document blocks.
 */
export async function classifyPdfDocument(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
): Promise<PdfClass> {
  const base64Pdf = await fetchTwilioPdfBase64(mediaUrl, accountSid, authToken)
  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 20,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
          } as never,
          {
            type: 'text',
            text:
              'Classify this document into exactly ONE category based on its first page. Reply with only the category word:\n' +
              '- TICKET (a flight/train/bus travel ticket, boarding pass, e-ticket, or itinerary with a PNR/flight number — NOT a purchase receipt)\n' +
              '- DOCUMENT (a lease, contract, licence, ID, invoice, bill, statement, report, form, letter, notes, or any other paperwork)\n' +
              '- OTHER (anything that is not a travel ticket or a readable document)\n' +
              'Reply with one word only.',
          },
        ],
      },
    ],
  })
  const ans = (result.content[0]?.type === 'text' ? result.content[0].text : '').trim().toUpperCase()
  console.log('[pdf-reader] first-page class:', ans.slice(0, 20))
  if (ans.includes('TICKET')) return 'TICKET'
  if (ans.includes('OTHER')) return 'OTHER'
  return 'DOCUMENT'
}

const PDF_SUMMARY_SYSTEM =
  'You are AskGogo reading a PDF a user sent on WhatsApp. First decide whether it is a medical prescription/health/lab note, or a normal document (lease, contract, licence, ID, bill/receipt, statement, form, letter, notes). If it is medical, never guess medicine names, dosage, timing, diagnosis, or lab values when unclear — mark unclear parts as [unclear] and give no medical advice. Return plain WhatsApp-friendly text only.'

/**
 * Read a non-ticket PDF and return a WhatsApp-friendly summary. Mirrors
 * readAndSummarizeImageNote: same medical-vs-normal split and the same section
 * headings, so the webhook can reuse compactImageNoteForSaving() to store the
 * result in the notes list. Uses Sonnet (the model parsePdfTicket already relies
 * on) because it handles both text- and image-based PDFs.
 */
export async function readAndSummarizePdfDocument(params: {
  mediaUrl: string
  accountSid: string
  authToken: string
  userCaption?: string
}): Promise<string> {
  const base64Pdf = await fetchTwilioPdfBase64(params.mediaUrl, params.accountSid, params.authToken)
  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1200,
    system: PDF_SUMMARY_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
          } as never,
          {
            type: 'text',
            text:
              `User caption: ${params.userCaption || 'No caption'}\n\n` +
              'Read this document carefully. If it is a doctor prescription, clinic note, lab/health report, or medicine note, output exactly this medical format:\n\n' +
              '📝 *Prescription / medical note read*\n\n' +
              '*Important*\n' +
              '• Handwritten or scanned notes can be unclear. Please verify medicine names, dosage, and timing with the doctor/pharmacist.\n\n' +
              '*Patient / clinic details*\n' +
              '• Patient, doctor/clinic, and date if visible, otherwise [unclear]\n\n' +
              '*Vitals / test values visible*\n' +
              '• List visible values (TG, LDL, BP…) exactly as written, [unclear] if unsure\n\n' +
              '*Medicines / instructions visible*\n' +
              '• Medicine name / strength / timing / duration — [unclear] where not legible\n\n' +
              '*Extracted text*\n' +
              'Key lines, preserving uncertainty with [unclear].\n\n' +
              '*Next actions*\n' +
              '• Practical next steps only.\n\n' +
              'If it is NOT medical, output exactly this normal format:\n\n' +
              '📄 *Document read*\n\n' +
              '*Summary*\n' +
              '• what this document is and the 2-3 most important facts (parties, dates, amounts, reference numbers)\n' +
              '• bullet 2\n\n' +
              '*Extracted text*\n' +
              'The key readable text (names, dates, amounts, reference numbers). Use [unclear] instead of guessing.\n\n' +
              '*Next actions*\n' +
              '• action if any',
          },
        ],
      },
    ],
  })
  const text = result.content[0]?.type === 'text' ? result.content[0].text.trim() : ''
  if (!text) throw new Error('Could not read document')
  return text
}

/**
 * Download an image (flight/train/event ticket photo) from Twilio and parse it
 * with Claude vision. Same JSON contract as parsePdfTicket. Returns null for
 * anything that isn't a recognisable ticket, so callers can safely fall back.
 */
export async function parseImageTicket(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
  mediaType: string = 'image/jpeg'
): Promise<TicketInfo> {
  console.log('[ticket-reader] Fetching ticket image from Twilio:', mediaUrl)

  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
    },
  })

  if (!response.ok) {
    console.error('[ticket-reader] Failed to fetch image:', response.status, response.statusText)
    throw new Error(`Failed to fetch image: ${response.status}`)
  }

  const imgBuffer = await response.arrayBuffer()
  const base64Img = Buffer.from(imgBuffer).toString('base64')
  const cleanMediaType = mediaType.includes('png') ? 'image/png' : 'image/jpeg'

  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: cleanMediaType,
              data: base64Img,
            },
          } as never,
          {
            type: 'text',
            text: TICKET_EXTRACT_PROMPT,
          },
        ],
      },
    ],
  })

  const text = result.content[0]?.type === 'text' ? result.content[0].text.trim() : ''
  return parseTicketJson(text)
}

/**
 * Build the WhatsApp reply for a parsed ticket
 */
export function buildTicketReply(info: TicketInfo, reminderSet = true): string {
  if (!info)
    return "📄 I received your PDF but couldn't extract travel details."

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
