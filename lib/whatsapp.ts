import { qaTraceReply } from './qa-trace'
import { maskOutboundIdentifiers } from '@/lib/security/outbound-identifiers'
import twilio from 'twilio'
import { recordMeterEvent } from '@/lib/metering/record'
import { deliveryCallbackUrl, persistAcceptedChunk } from '@/lib/services/delivery-callback'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const rawWhatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER
const CALENDAR_APPROVAL_CONTENT_SID = 'HX8bb5cb6116ee401e81b1a59a864393d2'

const client = twilio(accountSid!, authToken!)

// Every outbound WhatsApp message is metered for the admin console (cost per person).
async function meteredCreate(payload: any) {
  const message = await client.messages.create(payload)
  void recordMeterEvent({ vendor: 'twilio', category: 'whatsapp.outbound', metadata: { template: !!payload?.contentSid } })
  return message
}

function normalizeWhatsAppAddress(value: string): string {
  const clean = (value || '').trim()

  if (!clean) {
    throw new Error('Missing WhatsApp phone number')
  }

  if (clean.startsWith('whatsapp:')) {
    return clean
  }

  const normalized = clean.replace(/[^\d+]/g, '')

  if (!normalized) {
    throw new Error(`Invalid WhatsApp phone number: ${value}`)
  }

  return `whatsapp:${normalized}`
}

// Central WhatsApp text sanitizer. WhatsApp does not render Markdown, so any
// route that sends a message must have its raw Markdown normalized here — this
// is the single chokepoint every send funnels through, so nothing can bypass it.
// Designed to be idempotent: text that is already WhatsApp-formatted is left as-is.
export function sanitizeMarkdownForWhatsApp(input: string): string {
  let text = String(input ?? '')

  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*')
  text = text.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, '*$1*')
  text = text.replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
  text = text.replace(/^([ \t]*)-[ \t]+/gm, '$1• ')
  text = text.replace(/[ \t]*\[\d+\]/g, '')

  return text
}

const WA_MAX_CHARS = 1550

function splitIntoChunks(text: string): string[] {
  if (text.length <= WA_MAX_CHARS) return [text]

  const chunks: string[] = []
  const sections = text.split(/\n\n/)
  let current = ''

  for (const section of sections) {
    const candidate = current ? current + '\n\n' + section : section
    if (candidate.length <= WA_MAX_CHARS) {
      current = candidate
    } else {
      if (current) chunks.push(current)
      if (section.length > WA_MAX_CHARS) {
        const lines = section.split('\n')
        let lineChunk = ''
        for (const line of lines) {
          const c = lineChunk ? lineChunk + '\n' + line : line
          if (c.length <= WA_MAX_CHARS) {
            lineChunk = c
          } else {
            if (lineChunk) chunks.push(lineChunk)
            lineChunk = line
          }
        }
        if (lineChunk) current = lineChunk
        else current = ''
      } else {
        current = section
      }
    }
  }
  if (current) chunks.push(current)
  return chunks.filter(c => c.trim())
}

const statusCallbackUrl = (process.env.TWILIO_STATUS_CALLBACK_URL || '').trim()

export async function sendWhatsApp(toNumber: string, text: string, mediaUrl?: string | null, deliveryToken?: string) {
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)

  // Never send a full card, Aadhaar or PAN number (outbound leak filter).
  const chunks = splitIntoChunks(sanitizeMarkdownForWhatsApp(maskOutboundIdentifiers(text || '')))
  qaTraceReply(chunks.join('\n\n'))
  let lastMessage: any = null

  for (let i = 0; i < chunks.length; i++) {
    const payload: any = { body: chunks[i], from, to }
    if (statusCallbackUrl || deliveryToken) payload.statusCallback = deliveryCallbackUrl(statusCallbackUrl, deliveryToken, i + 1, chunks.length)
    if (i === 0 && mediaUrl && mediaUrl.trim()) payload.mediaUrl = [mediaUrl.trim()]

    let message
    try { message = await meteredCreate(payload) }
    catch (error) {
      // A later chunk's rejection cannot make earlier accepted chunks safe to retry.
      if (i > 0 && error && typeof error === 'object') Object.assign(error, { partialSend: true })
      throw error
    }
    lastMessage = message
    await persistAcceptedChunk(message.sid, deliveryToken, i + 1, chunks.length)

    console.log('WHATSAPP_SENT:', {
      sid: message.sid,
      from,
      to,
      status: message.status,
      chunk: chunks.length > 1 ? `${i + 1}/${chunks.length}` : undefined,
      hasMedia: i === 0 && Boolean(mediaUrl),
    })

    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300))
  }

  return lastMessage
}

// WhatsApp template variables reject line breaks, tabs and repeated whitespace.
// Keep the canonical reminder unchanged; normalize only the outbound variable.
function reminderTemplateLabel(label:string):string {
  return (String(label || '').replace(/\s+/g, ' ').trim() || 'your task').slice(0, 400)
}

export async function sendWhatsAppReminderTemplate(toNumber: string, label: string, deliveryToken?: string) {
  const contentSid = process.env.TWILIO_REMINDER_CONTENT_SID
  if (!contentSid) throw new Error('Missing TWILIO_REMINDER_CONTENT_SID')
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)
  const payload: any = {
    from,
    to,
    contentSid,
    contentVariables: JSON.stringify({ '1': reminderTemplateLabel(label) }),
  }
  if (statusCallbackUrl || deliveryToken) payload.statusCallback = deliveryCallbackUrl(statusCallbackUrl, deliveryToken)
  const message = await meteredCreate(payload)
  await persistAcceptedChunk(message.sid, deliveryToken, 1, 1)
  console.log('WHATSAPP_TEMPLATE_SENT:', { sid: message.sid, to, status: message.status })
  return message
}

export async function sendWhatsAppReminderButtons(toNumber: string, label: string, deliveryToken?: string) {
  const contentSid = process.env.TWILIO_REMINDER_BUTTONS_CONTENT_SID
  if (!contentSid) throw new Error('Missing TWILIO_REMINDER_BUTTONS_CONTENT_SID')
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)
  const payload: any = {
    from,
    to,
    contentSid,
    contentVariables: JSON.stringify({ '1': reminderTemplateLabel(label) }),
  }
  if (statusCallbackUrl || deliveryToken) payload.statusCallback = deliveryCallbackUrl(statusCallbackUrl, deliveryToken)
  const message = await meteredCreate(payload)
  await persistAcceptedChunk(message.sid, deliveryToken, 1, 1)
  console.log('WHATSAPP_BUTTONS_TEMPLATE_SENT:', { sid: message.sid, to, status: message.status })
  return message
}

export async function sendWhatsAppCalendarApprovalButtons(
  toNumber: string,
  title: string,
  when: string,
  duration: string = '30 mins'
) {
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)
  const payload: any = {
    from,
    to,
    contentSid: CALENDAR_APPROVAL_CONTENT_SID,
    contentVariables: JSON.stringify({
      '1': String(title || 'Meeting').slice(0, 400),
      '2': String(when || '').slice(0, 200),
      '3': String(duration || '30 mins').slice(0, 100),
    }),
  }
  if (statusCallbackUrl) payload.statusCallback = statusCallbackUrl
  const message = await meteredCreate(payload)
  console.log('WHATSAPP_CALENDAR_APPROVAL_SENT:', { sid: message.sid, to, status: message.status })
  return message
}

// ---- tap choices (quick-reply buttons and a list menu) for the flight questions -----------------------
// Twilio sends these from a content template. The template is created once through the Content API and
// reused by name. They are session messages (the person has just written to Gogo), and a tap comes back
// as ordinary text, so no reply handling is needed beyond what typed answers already get.
const choiceContentCache = new Map<string, string>()

async function ensureChoiceContent(kind: string, options: { title: string; description?: string }[]): Promise<string> {
  const friendlyName = `gogo_flight_choice_${kind}_v1`
  const cached = choiceContentCache.get(friendlyName)
  if (cached) return cached
  const existing = (await client.content.v1.contents.list({ pageSize: 200, limit: 400 })).find(item => item.friendlyName === friendlyName)
  if (existing?.sid) { choiceContentCache.set(friendlyName, existing.sid); return existing.sid }
  const id = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const types: any = options.some(o => o.description)
    ? { 'twilio/list-picker': { body: '{{1}}', button: 'Choose time', items: options.map(o => ({ item: o.title, id: id(o.title), description: o.description || '' })) } }
    : { 'twilio/quick-reply': { body: '{{1}}', actions: options.map(o => ({ title: o.title, id: id(o.title) })) } }
  const created = await client.content.v1.contents.create({ friendlyName, language: 'en', variables: { '1': 'Question' }, types } as any)
  choiceContentCache.set(friendlyName, created.sid)
  return created.sid
}

export async function sendWhatsAppChoice(toNumber: string, kind: string, body: string, options: { title: string; description?: string }[]) {
  const contentSid = await ensureChoiceContent(kind, options)
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)
  const payload: any = { from, to, contentSid, contentVariables: JSON.stringify({ '1': String(body || '').replace(/\s+/g, ' ').trim().slice(0, 900) }) }
  if (statusCallbackUrl) payload.statusCallback = statusCallbackUrl
  const message = await meteredCreate(payload)
  console.log('WHATSAPP_CHOICE_SENT:', { sid: message.sid, to, kind, status: message.status })
  return message
}

// Dashboard login OTP sent through an approved WhatsApp Authentication template.
// The OTP is generated and verified by AskGogo; Twilio only delivers it. The
// content template should use {{1}} for the six-digit code / copy-code button.
export async function sendWhatsAppAuthOtp(toNumber: string, otp: string) {
  const contentSid = (process.env.TWILIO_AUTH_OTP_CONTENT_SID || '').trim()
  if (!contentSid) throw new Error('Missing TWILIO_AUTH_OTP_CONTENT_SID')
  if (!/^\d{6}$/.test(otp)) throw new Error('Invalid dashboard OTP')

  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)
  const payload: any = {
    from,
    to,
    contentSid,
    contentVariables: JSON.stringify({ '1': otp }),
  }
  if (statusCallbackUrl) payload.statusCallback = statusCallbackUrl

  const message = await meteredCreate(payload)
  console.log('WHATSAPP_AUTH_OTP_SENT:', { sid: message.sid, to, status: message.status })
  return message
}

export async function sendWhatsAppTypingIndicator(messageSid?: string | null) {
  const sid = (messageSid || '').trim()

  if (!sid || !accountSid || !authToken) return false

  const params = new URLSearchParams()
  params.append('messageId', sid)
  params.append('channel', 'whatsapp')

  const response = await fetch('https://messaging.twilio.com/v2/Indicators/Typing.json', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error('WHATSAPP_TYPING_INDICATOR_FAILED:', {
      status: response.status,
      body,
      messageSid: sid,
    })
    return false
  }

  console.log('WHATSAPP_TYPING_INDICATOR_SENT:', { messageSid: sid })
  return true
}

// ---- access granted (admin approves a waitlist number) ---------------------------------------------
// The full welcome goes as free text, which WhatsApp delivers only inside the 24-hour window (the person
// messaged us recently). Outside it, an approved template is required: one is created through the Content
// API and submitted to WhatsApp for approval (UTILITY) on first use, then used once Meta approves it.
const ACCESS_TEMPLATE_NAME = 'askgogo_access_granted_v1'
let accessTemplateSid: string | null = null

export async function accessTemplateStatus(body: string): Promise<{ sid: string | null; status: string }> {
  const override = (process.env.TWILIO_INVITE_CONTENT_SID || '').trim()
  if (override) return { sid: override, status: 'approved' }
  try {
    if (!accessTemplateSid) {
      const existing = (await client.content.v1.contents.list({ pageSize: 200, limit: 400 })).find(item => item.friendlyName === ACCESS_TEMPLATE_NAME)
      accessTemplateSid = existing?.sid || (await client.content.v1.contents.create({ friendlyName: ACCESS_TEMPLATE_NAME, language: 'en', variables: { '1': 'there' }, types: { 'twilio/text': { body } } } as any)).sid
    }
    const approval: any = await (client.content.v1.contents(accessTemplateSid!) as any).approvalFetch().fetch().catch(() => null)
    const status = String(approval?.whatsapp?.status || '').toLowerCase()
    if (!status || status === 'unsubmitted') {
      await (client.content.v1.contents(accessTemplateSid!) as any).approvalCreate.create({ name: ACCESS_TEMPLATE_NAME, category: 'UTILITY' })
      return { sid: accessTemplateSid, status: 'submitted' }
    }
    return { sid: accessTemplateSid, status }
  } catch (err: any) {
    console.error('ACCESS_TEMPLATE_STATUS_FAILED', err?.code || '', err?.message || err)
    return { sid: accessTemplateSid, status: 'error' }
  }
}

/** Tell an approved person they can start. Returns what happened, in plain words, for the admin console. */
export async function sendWhatsAppAccessGranted(toNumber: string, firstName: string, fullText: string, templateBody: string): Promise<string> {
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)
  const template = await accessTemplateStatus(templateBody)
  try {
    if (template.sid && template.status === 'approved') {
      const payload: any = { from, to, contentSid: template.sid, contentVariables: JSON.stringify({ '1': firstName || 'there' }) }
      if (statusCallbackUrl) payload.statusCallback = statusCallbackUrl
      const message = await meteredCreate(payload)
      console.log('WHATSAPP_ACCESS_GRANTED_SENT:', { sid: message.sid, to, via: 'template' })
      return 'sent (WhatsApp template)'
    }
    const payload: any = { from, to, body: fullText }
    if (statusCallbackUrl) payload.statusCallback = statusCallbackUrl
    const message = await meteredCreate(payload)
    console.log('WHATSAPP_ACCESS_GRANTED_SENT:', { sid: message.sid, to, via: 'text', template: template.status })
    return `sent as text; template ${template.status === 'error' ? 'not ready' : template.status === 'submitted' || template.status === 'pending' || template.status === 'received' ? 'waiting for WhatsApp approval' : template.status}`
  } catch (err: any) {
    return `not sent: ${String(err?.message || 'error').slice(0, 80)}`
  }
}
