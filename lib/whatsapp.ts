import { qaTraceReply } from './qa-trace'
import { maskOutboundIdentifiers } from '@/lib/security/outbound-identifiers'
import twilio from 'twilio'
import { recordMeterEvent } from '@/lib/metering/record'
import { deliveryCallbackUrl, persistAcceptedChunk } from '@/lib/services/delivery-callback'
import { isMetaMessageId, waProviderFor } from '@/lib/channels/whatsapp-provider/provider'
import { META_CAPTION_MAX, metaButtonsPayload, metaListPayload, metaMediaPayload, metaSend, metaTemplatePayload, metaTextPayload, metaTypingPayload } from '@/lib/channels/whatsapp-provider/meta'

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

// ---- Meta Cloud API path (off unless configured and selected; see lib/channels/whatsapp-provider/provider.ts) ----
// Returns the same shape callers read from a Twilio message: { sid, status }.
async function meteredMetaSend(payload: Record<string, unknown>, template = false) {
  const message = await metaSend(payload)
  void recordMeterEvent({ vendor: 'meta', category: 'whatsapp.outbound', metadata: { template } })
  return message
}
const metaTemplateName = (envKey: string, fallback: string) => (process.env[envKey] || '').trim() || fallback
const metaTemplateLanguage = () => (process.env.GOGO_META_TPL_LANG || '').trim() || 'en'
const choiceId = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

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
  const to = normalizeWhatsAppAddress(toNumber)

  // Never send a full card, Aadhaar or PAN number (outbound leak filter).
  const chunks = splitIntoChunks(sanitizeMarkdownForWhatsApp(maskOutboundIdentifiers(text || '')))
  qaTraceReply(chunks.join('\n\n'))
  let lastMessage: any = null

  if (waProviderFor(to) === 'meta') {
    const media = (mediaUrl || '').trim()
    for (let i = 0; i < chunks.length; i++) {
      let message
      try {
        if (i === 0 && media) {
          // A caption holds 1,024 characters; a longer first chunk goes as its own text after the media.
          const fits = chunks[0].length <= META_CAPTION_MAX
          message = await meteredMetaSend(metaMediaPayload(to, media, fits ? chunks[0] : null))
          if (!fits && chunks[0]) message = await meteredMetaSend(metaTextPayload(to, chunks[0]))
        } else {
          message = await meteredMetaSend(metaTextPayload(to, chunks[i]))
        }
      } catch (error) {
        if (i > 0 && error && typeof error === 'object') Object.assign(error, { partialSend: true })
        throw error
      }
      lastMessage = message
      await persistAcceptedChunk(message.sid, deliveryToken, i + 1, chunks.length)
      console.log('WHATSAPP_SENT:', { sid: message.sid, provider: 'meta', to, status: message.status, chunk: chunks.length > 1 ? `${i + 1}/${chunks.length}` : undefined, hasMedia: i === 0 && Boolean(media) })
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300))
    }
    return lastMessage
  }
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)

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

/**
 * Waits (bounded) until WhatsApp has the message: sent, delivered or read. Used so an image card lands before the
 * text that follows it; media is fetched by Twilio first, so an immediate text overtakes it. Returns the last status.
 */
export async function waitForWhatsAppSent(sid: string, maxMs = 8000, deps: { fetchStatus?: (sid: string) => Promise<string>; sleep?: (ms: number) => Promise<void> } = {}) {
  const sleep = deps.sleep || ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  // Meta has no status lookup (statuses arrive only on the webhook), so give the media a short head start.
  if (isMetaMessageId(sid) && !deps.fetchStatus) { await sleep(Math.min(maxMs, 2000)); return 'accepted' }
  const fetchStatus = deps.fetchStatus || (async (id: string) => String((await client.messages(id).fetch())?.status || ''))
  let status = ''
  for (let waited = 0; waited <= maxMs; waited += 1000) {
    try { status = await fetchStatus(sid) } catch { return status || 'unknown' }
    if (['sent', 'delivered', 'read', 'failed', 'undelivered'].includes(status)) return status
    await sleep(1000)
  }
  return status || 'pending'
}

// WhatsApp template variables reject line breaks, tabs and repeated whitespace.
// Keep the canonical reminder unchanged; normalize only the outbound variable.
function reminderTemplateLabel(label:string):string {
  return (String(label || '').replace(/\s+/g, ' ').trim() || 'your task').slice(0, 400)
}

export async function sendWhatsAppReminderTemplate(toNumber: string, label: string, deliveryToken?: string) {
  if (waProviderFor(toNumber) === 'meta') {
    const message = await meteredMetaSend(metaTemplatePayload(toNumber, metaTemplateName('GOGO_META_TPL_REMINDER', 'gogo_reminder_v1'), { language: metaTemplateLanguage(), bodyParams: [reminderTemplateLabel(label)] }), true)
    await persistAcceptedChunk(message.sid, deliveryToken, 1, 1)
    console.log('WHATSAPP_TEMPLATE_SENT:', { sid: message.sid, provider: 'meta', status: message.status })
    return message
  }
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
  if (waProviderFor(toNumber) === 'meta') {
    // Same three taps the inbound handler already understands: done, snooze_10, move_8pm.
    const message = await meteredMetaSend(metaTemplatePayload(toNumber, metaTemplateName('GOGO_META_TPL_REMINDER_BUTTONS', 'gogo_reminder_buttons_v1'), { language: metaTemplateLanguage(), bodyParams: [reminderTemplateLabel(label)], quickReplyPayloads: ['done', 'snooze_10', 'move_8pm'] }), true)
    await persistAcceptedChunk(message.sid, deliveryToken, 1, 1)
    console.log('WHATSAPP_BUTTONS_TEMPLATE_SENT:', { sid: message.sid, provider: 'meta', status: message.status })
    return message
  }
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
  if (waProviderFor(toNumber) === 'meta') {
    // Sent inside the conversation window, so ordinary reply buttons need no template. The inbound handler resolves
    // "Approve" and "Reject" against the pending approval.
    const body = ['Ready to add. Approval required.', String(title || 'Meeting').slice(0, 400), String(when || '').slice(0, 200), `Duration: ${String(duration || '30 mins').slice(0, 100)}`].filter(Boolean).join('\n')
    const message = await meteredMetaSend(metaButtonsPayload(toNumber, body, [{ id: 'approve', title: 'Approve' }, { id: 'reject', title: 'Reject' }]))
    console.log('WHATSAPP_CALENDAR_APPROVAL_SENT:', { sid: message.sid, provider: 'meta', status: message.status })
    return message
  }
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
  if (waProviderFor(toNumber) === 'meta') {
    const question = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 900)
    const asList = options.some(o => o.description) || options.length > 3
    const payload = asList
      ? metaListPayload(toNumber, question, 'Choose', options.map(o => ({ id: choiceId(o.title), title: o.title, description: o.description })))
      : metaButtonsPayload(toNumber, question, options.map(o => ({ id: choiceId(o.title), title: o.title })))
    const message = await meteredMetaSend(payload)
    console.log('WHATSAPP_CHOICE_SENT:', { sid: message.sid, provider: 'meta', kind, status: message.status })
    return message
  }
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
  if (!/^\d{6}$/.test(otp)) throw new Error('Invalid dashboard OTP')
  if (waProviderFor(toNumber) === 'meta') {
    const message = await meteredMetaSend(metaTemplatePayload(toNumber, metaTemplateName('GOGO_META_TPL_AUTH_OTP', 'gogo_login_code_v1'), { language: metaTemplateLanguage(), bodyParams: [otp], otpCode: otp }), true)
    console.log('WHATSAPP_AUTH_OTP_SENT:', { sid: message.sid, provider: 'meta', status: message.status })
    return message
  }
  const contentSid = (process.env.TWILIO_AUTH_OTP_CONTENT_SID || '').trim()
  if (!contentSid) throw new Error('Missing TWILIO_AUTH_OTP_CONTENT_SID')

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

  if (isMetaMessageId(sid)) {
    try { await metaSend(metaTypingPayload(sid)); console.log('WHATSAPP_TYPING_INDICATOR_SENT:', { provider: 'meta' }); return true }
    catch (error: any) { console.error('WHATSAPP_TYPING_INDICATOR_FAILED:', { provider: 'meta', status: error?.status || 0 }); return false }
  }
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
  if (waProviderFor(toNumber) === 'meta') {
    // The approved person has usually not written yet, so this goes as the approved template; the full welcome
    // follows as text only if Meta accepts it (inside the conversation window).
    try {
      const message = await meteredMetaSend(metaTemplatePayload(toNumber, metaTemplateName('GOGO_META_TPL_ACCESS_GRANTED', ACCESS_TEMPLATE_NAME), { language: metaTemplateLanguage(), bodyParams: [firstName || 'there'] }), true)
      console.log('WHATSAPP_ACCESS_GRANTED_SENT:', { sid: message.sid, provider: 'meta', via: 'template' })
      return 'sent (WhatsApp template)'
    } catch (err: any) {
      try {
        const message = await meteredMetaSend(metaTextPayload(toNumber, sanitizeMarkdownForWhatsApp(fullText)))
        console.log('WHATSAPP_ACCESS_GRANTED_SENT:', { sid: message.sid, provider: 'meta', via: 'text' })
        return 'sent as text; template not ready'
      } catch (inner: any) { return `not sent: ${String(inner?.message || err?.message || 'error').slice(0, 80)}` }
    }
  }
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
