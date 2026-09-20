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

const AIRPORT_CITY: Record<string,string> = {
  BLR: 'Bengaluru',
  AUH: 'Abu Dhabi',
  JFK: 'New York',
  DEL: 'Delhi',
  BOM: 'Mumbai',
  DXB: 'Dubai',
  LHR: 'London',
  SIN: 'Singapore',
}

function airlineNameFromPrefix(prefix:string){
  const key=String(prefix||'').toUpperCase()
  if(key==='EY')return 'Etihad'
  if(key==='AI')return 'Air India'
  if(key==='6E')return 'IndiGo'
  if(key==='EK')return 'Emirates'
  return key
}

export function classifyPdfTextLocally(text:string):PdfClass|null{
  const raw=String(text||'').trim()
  if(raw.length<40)return null
  const ticketSignal=/\b(?:booking\s*reference|pnr|electronic\s+ticket|boarding\s+pass|ticket\s+number)\b/i.test(raw)
  const airportSignal=(raw.match(/\b[A-Z]{3}\b/g)||[]).length>=2
  const timeSignal=/\b\d{1,2}:\d{2}\b/.test(raw)
  if(ticketSignal&&airportSignal&&timeSignal)return 'TICKET'
  return null
}

export function parseFlightTicketText(text:string):FlightInfo|null{
  const raw=String(text||'').replace(/\r/g,' ').replace(/[ \t]+/g,' ').trim()
  if(!raw)return null
  const pnr=raw.match(/\b(?:booking\s*reference|pnr)\s*[:#-]?\s*([A-Z0-9]{5,8})\b/i)?.[1]?.toUpperCase()
  if(!pnr)return null

  const passengerMatch=raw.match(/(?:^|\n)\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s*(?:\n|\s)+Thank you for your booking/i)
  const passengers=passengerMatch?.[1]?[passengerMatch[1].trim()]:[]

  const flightNos:Array<{prefix:string;number:string}>=[]
  const seen=new Set<string>()
  for(const m of raw.matchAll(/\b([A-Z0-9]{2})\s*([0-9]{1,4})\b/g)){
    const prefix=m[1].toUpperCase()
    const number=m[2]
    if(!/[A-Z]/.test(prefix))continue
    const key=prefix+number
    if(seen.has(key))continue
    seen.add(key)
    flightNos.push({prefix,number})
    if(flightNos.length>=12)break
  }

  const legs:FlightInfo['flights']=[]
  const legRe=/\b([A-Z]{3})\s+(\d{1,2}:\d{2})\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})[\s\S]{0,260}?\b([A-Z]{3})\s+(\d{1,2}:\d{2})\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/g
  let match:RegExpExecArray|null
  while((match=legRe.exec(raw))&&legs.length<8){
    const fromCode=match[1].toUpperCase()
    const toCode=match[4].toUpperCase()
    if(fromCode===toCode)continue
    const flight=flightNos[legs.length]||flightNos[0]
    if(!flight)continue
    legs.push({
      from:AIRPORT_CITY[fromCode]||fromCode,
      to:AIRPORT_CITY[toCode]||toCode,
      date:match[3].replace(/\s+/g,' ').trim(),
      departure:match[2],
      arrival:match[5],
      airline:airlineNameFromPrefix(flight.prefix),
      flightNo:`${flight.prefix}${flight.number}`,
      pnr,
    })
  }

  if(!legs.length)return null
  return {type:'flight',flights:legs,passengers}
}

class ServerlessDOMMatrix {
  a=1;b=0;c=0;d=1;e=0;f=0;is2D=true
  constructor(init?:number[]|Float32Array|Float64Array|{a?:number;b?:number;c?:number;d?:number;e?:number;f?:number}){
    if(Array.isArray(init)||ArrayBuffer.isView(init)){
      const v=Array.from(init as ArrayLike<number>)
      this.a=Number(v[0]??1);this.b=Number(v[1]??0);this.c=Number(v[2]??0)
      this.d=Number(v[3]??1);this.e=Number(v[4]??0);this.f=Number(v[5]??0)
    }else if(init&&typeof init==='object'){
      this.a=Number(init.a??1);this.b=Number(init.b??0);this.c=Number(init.c??0)
      this.d=Number(init.d??1);this.e=Number(init.e??0);this.f=Number(init.f??0)
    }
  }
  private set(m:ServerlessDOMMatrix){this.a=m.a;this.b=m.b;this.c=m.c;this.d=m.d;this.e=m.e;this.f=m.f;return this}
  multiply(other:any){
    const o=other instanceof ServerlessDOMMatrix?other:new ServerlessDOMMatrix(other)
    return new ServerlessDOMMatrix([
      this.a*o.a+this.c*o.b,
      this.b*o.a+this.d*o.b,
      this.a*o.c+this.c*o.d,
      this.b*o.c+this.d*o.d,
      this.a*o.e+this.c*o.f+this.e,
      this.b*o.e+this.d*o.f+this.f,
    ])
  }
  multiplySelf(other:any){return this.set(this.multiply(other))}
  preMultiplySelf(other:any){return this.set((other instanceof ServerlessDOMMatrix?other:new ServerlessDOMMatrix(other)).multiply(this))}
  translate(tx=0,ty=0){return this.multiply(new ServerlessDOMMatrix([1,0,0,1,tx,ty]))}
  translateSelf(tx=0,ty=0){return this.set(this.translate(tx,ty))}
  scale(scaleX=1,scaleY=scaleX){return this.multiply(new ServerlessDOMMatrix([scaleX,0,0,scaleY,0,0]))}
  scaleSelf(scaleX=1,scaleY=scaleX){return this.set(this.scale(scaleX,scaleY))}
  rotate(angle=0){
    const r=angle*Math.PI/180,s=Math.sin(r),co=Math.cos(r)
    return this.multiply(new ServerlessDOMMatrix([co,s,-s,co,0,0]))
  }
  rotateSelf(angle=0){return this.set(this.rotate(angle))}
  inverse(){
    const det=this.a*this.d-this.b*this.c
    if(!det)return new ServerlessDOMMatrix([NaN,NaN,NaN,NaN,NaN,NaN])
    return new ServerlessDOMMatrix([
      this.d/det,-this.b/det,-this.c/det,this.a/det,
      (this.c*this.f-this.d*this.e)/det,
      (this.b*this.e-this.a*this.f)/det,
    ])
  }
  invertSelf(){return this.set(this.inverse())}
  transformPoint(point:any={x:0,y:0}){
    const x=Number(point?.x||0),y=Number(point?.y||0)
    return {x:this.a*x+this.c*y+this.e,y:this.b*x+this.d*y+this.f,z:0,w:1}
  }
  toFloat32Array(){return new Float32Array([this.a,this.b,this.c,this.d,this.e,this.f])}
  toFloat64Array(){return new Float64Array([this.a,this.b,this.c,this.d,this.e,this.f])}
}

export function ensurePdfJsServerlessGlobals(){
  const g:any=globalThis as any
  if(typeof g.DOMMatrix==='undefined')g.DOMMatrix=ServerlessDOMMatrix
  if(typeof g.ImageData==='undefined')g.ImageData=class ImageData {
    data:Uint8ClampedArray;width:number;height:number
    constructor(dataOrWidth:any,widthOrHeight:any,heightMaybe?:number){
      if(typeof dataOrWidth==='number'){
        this.width=dataOrWidth;this.height=Number(widthOrHeight||0)
        this.data=new Uint8ClampedArray(this.width*this.height*4)
      }else{
        this.data=dataOrWidth instanceof Uint8ClampedArray?dataOrWidth:new Uint8ClampedArray(dataOrWidth||[])
        this.width=Number(widthOrHeight||0);this.height=Number(heightMaybe||0)
      }
    }
  }
  if(typeof g.Path2D==='undefined')g.Path2D=class Path2D { constructor(_path?:any){} addPath(_path:any,_transform?:any){} }
}

export async function extractPdfTextLocally(pdfBuffer:Buffer):Promise<string>{
  try{
    ensurePdfJsServerlessGlobals()
    const mod:any=await import('pdf-parse')
    if(typeof mod.PDFParse==='function'){
      const parser=new mod.PDFParse({data:pdfBuffer})
      try{
        const result=await parser.getText()
        return String(result?.text||'').trim()
      }finally{
        await parser.destroy?.()
      }
    }
    const legacy=mod.default||mod
    if(typeof legacy==='function'){
      const result=await legacy(pdfBuffer)
      return String(result?.text||'').trim()
    }
  }catch(error:any){
    console.warn('[pdf-reader] local text extraction failed:',error?.message||error)
  }
  return ''
}

async function fetchTwilioPdfBuffer(
  mediaUrl:string,
  accountSid:string,
  authToken:string,
):Promise<Buffer>{
  const response=await fetch(mediaUrl,{
    headers:{Authorization:'Basic '+Buffer.from(`${accountSid}:${authToken}`).toString('base64')},
  })
  if(!response.ok){
    console.error('[pdf-reader] Failed to fetch PDF:',response.status,response.statusText)
    throw new Error(`Failed to fetch PDF: ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
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
  const pdfBuffer=await fetchTwilioPdfBuffer(mediaUrl,accountSid,authToken)
  console.log('[pdf-reader] PDF fetched, bytes:',pdfBuffer.byteLength)

  // Text-based e-tickets should not depend on an external vision/LLM provider.
  // Parse them locally first so an Anthropic outage or exhausted balance does not
  // break travel ingestion, reminder creation, or Life Event state.
  const localText=await extractPdfTextLocally(pdfBuffer)
  const localTicket=parseFlightTicketText(localText)
  if(localTicket){
    console.log('[pdf-reader] local ticket parse succeeded:',localTicket.flights.length,'legs')
    return localTicket
  }

  const base64Pdf=pdfBuffer.toString('base64')
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

  const text=result.content[0]?.type==='text'?result.content[0].text.trim():''
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
  return (await fetchTwilioPdfBuffer(mediaUrl,accountSid,authToken)).toString('base64')
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
  const pdfBuffer=await fetchTwilioPdfBuffer(mediaUrl,accountSid,authToken)
  const localText=await extractPdfTextLocally(pdfBuffer)
  const localClass=classifyPdfTextLocally(localText)
  if(localClass){
    console.log('[pdf-reader] local class:',localClass)
    return localClass
  }
  const base64Pdf=pdfBuffer.toString('base64')
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
// reminderTail is a pre-built block (with its own leading blank line) that names the
// exact alerts created, e.g. "⏰ Departure alert Thu 27 Aug 11:30 · 🧳 Check-in alert
// Tue 25 Aug 14:30". The caller (persistAndRemindTicket) owns it because only it knows
// which alerts actually landed; buildTicketReply just renders the ticket details.
export function buildTicketReply(info: TicketInfo, reminderTail = ''): string {
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
    return `🎫 *Flight ticket saved!*\n\n${flightLines}${pax}${reminderTail}\n\n_Say *my reminders* to see all alerts_`
  }

  if (info.type === 'train') {
    const ti = info as TrainInfo
    const pax = ti.passengers.length > 0 ? `\n👥 ${ti.passengers.join(', ')}` : ''
    return `🚆 *Train ticket saved!*\n\n*${ti.from} → ${ti.to}*\n${ti.date} · ${ti.departure}\n${ti.trainName} (${ti.trainNo}) · PNR: \`${ti.pnr}\`${pax}${reminderTail}\n\n_Say *my reminders* to see all alerts_`
  }

  if (info.type === 'event') {
    const ei = info as EventInfo
    return `🎟️ *Event ticket saved!*\n\n*${ei.name}*\n${ei.date} · ${ei.time}\n📍 ${ei.venue}${reminderTail}\n\n_Say *my reminders* to see all alerts_`
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
